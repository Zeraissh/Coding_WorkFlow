/**
 * FileLockManager — 轻量级进程内文件锁
 *
 * 解决并发 Agent 写入同一文件的竞态条件。
 * 所有 Agent 在同一 Node.js 进程中运行，使用 Promise-based 内存锁即可，
 * 无需引入 Redis 等外部依赖。
 *
 * 设计要点：
 * - 写锁互斥（同时只有一个 Agent 能写）
 * - 读锁共享（不阻塞，但记录访问者用于冲突检测）
 * - 超时降级（防止死锁）
 * - 冲突日志（供 Verifier 第一阶段使用）
 */

import * as fs from 'fs';

// ============================================================================
// Types
// ============================================================================

export type LockMode = 'read' | 'write';

export interface FileLock {
  path: string;
  ownerAgentId: string;
  mode: LockMode;
  acquiredAt: number;
  reentryCount: number;
}

export interface WriteQueueItem {
  path: string;
  agentId: string;
  resolve: () => void;
  reject: (err: Error) => void;
}

export interface ConflictRecord {
  file: string;
  agents: string[];
  timestamp: number;
}

export interface FSLockConfig {
  enabled: boolean;
  timeoutMs: number; // 锁超时自动释放 (默认 30000)
}

// ============================================================================
// FileLockManager
// ============================================================================

export class FileLockManager {
  private static instance: FileLockManager;

  /** 当前持有的锁: filePath → FileLock */
  private locks: Map<string, FileLock> = new Map();

  /** 等待队列: filePath → 排队中的写请求列表 */
  private writeQueues: Map<string, WriteQueueItem[]> = new Map();

  /** 冲突日志: 被多个 Agent 写入的文件记录 */
  private conflictLog: ConflictRecord[] = [];

  /** 每个文件的写入历史: filePath → [agentId, ...] */
  private writeHistory: Map<string, string[]> = new Map();

  /** 活跃超时计时器: filePath → Timer */
  private timeoutTimers: Map<string, NodeJS.Timeout> = new Map();

  /** 全局开关 */
  private config: FSLockConfig = {
    enabled: true,
    timeoutMs: 30000,
  };

  private constructor() {}

  /** 获取单例 */
  static getInstance(): FileLockManager {
    if (!FileLockManager.instance) {
      FileLockManager.instance = new FileLockManager();
    }
    return FileLockManager.instance;
  }

  /** 更新配置 */
  configure(config: Partial<FSLockConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /** 重置（测试用） */
  reset(): void {
    for (const timer of this.timeoutTimers.values()) {
      clearTimeout(timer);
    }
    this.locks.clear();
    this.writeQueues.clear();
    this.conflictLog = [];
    this.writeHistory.clear();
    this.timeoutTimers.clear();
  }

  // ==========================================================================
  // 公共 API
  // ==========================================================================

  /**
   * 获取写锁（互斥）
   *
   * - 如果文件未被锁定 → 立即获得锁
   * - 如果文件已被其他 Agent 持有锁 → 进入等待队列
   * - 同一 Agent 重复请求同一文件 → 直接返回（重入）
   */
  async acquireWrite(filePath: string, agentId: string): Promise<void> {
    if (!this.config.enabled) return;

    const normalizedPath = this.normalizePath(filePath);
    const existing = this.locks.get(normalizedPath);

    // 同一 Agent 已持有该文件的写锁 → 重入
    if (existing && existing.ownerAgentId === agentId && existing.mode === 'write') {
      existing.reentryCount++;
      return;
    }

    // 文件被其他 Agent 锁定 → 入队等待
    if (existing) {
      return new Promise<void>((resolve, reject) => {
        const queue = this.writeQueues.get(normalizedPath) || [];
        queue.push({ path: normalizedPath, agentId, resolve, reject });
        this.writeQueues.set(normalizedPath, queue);
      });
    }

    // 立即获取锁
    this.grantWriteLock(normalizedPath, agentId);
  }

  /**
   * 获取读锁（共享，不阻塞）
   *
   * 读锁不互斥，但记录访问者供冲突检测使用。
   */
  async acquireRead(filePath: string, agentId: string): Promise<void> {
    if (!this.config.enabled) return;

    const normalizedPath = this.normalizePath(filePath);
    const existing = this.locks.get(normalizedPath);

    // 有写锁 → 仍允许读（读取的是当前写入前的版本这取决于时序）
    // 这里只记录，不阻塞
    if (!existing) {
      this.locks.set(normalizedPath, {
        path: normalizedPath,
        ownerAgentId: agentId,
        mode: 'read',
        acquiredAt: Date.now(),
        reentryCount: 0,
      });
      // 读锁没有超时，因为不阻塞他人
    }
  }

  /**
   * 释放锁
   */
  release(filePath: string, agentId: string): void {
    if (!this.config.enabled) return;

    const normalizedPath = this.normalizePath(filePath);
    const existing = this.locks.get(normalizedPath);

    // 锁不属于此 Agent → 忽略
    if (!existing || existing.ownerAgentId !== agentId) {
      return;
    }

    // 处理重入释放
    if (existing.reentryCount > 0) {
      existing.reentryCount--;
      return;
    }

    // 清除超时计时器
    const timer = this.timeoutTimers.get(normalizedPath);
    if (timer) {
      clearTimeout(timer);
      this.timeoutTimers.delete(normalizedPath);
    }

    // 释放锁
    this.locks.delete(normalizedPath);

    // 记录写入历史
    if (existing.mode === 'write') {
      const history = this.writeHistory.get(normalizedPath) || [];
      if (!history.includes(agentId)) {
        history.push(agentId);
        this.writeHistory.set(normalizedPath, history);
      }

      // 如果多个 Agent 写过同一文件 → 记录冲突
      if (history.length > 1) {
        this.conflictLog.push({
          file: normalizedPath,
          agents: [...history],
          timestamp: Date.now(),
        });
      }
    }

    // 处理等待队列中的下一个请求
    this.processQueue(normalizedPath);
  }

  /**
   * 同步安全写入封装
   * 确保执行底层写入的那一刻，Agent 仍然实际持有锁（防止超时剥夺引发脏写）
   */
  writeFile(filePath: string, agentId: string, content: string): void {
    const normalizedPath = this.normalizePath(filePath);
    
    if (this.config.enabled) {
      const existing = this.locks.get(normalizedPath);
      if (!existing || existing.ownerAgentId !== agentId || existing.mode !== 'write') {
        throw new Error(`Write failed: Agent ${agentId} does not hold a write lock for ${filePath}. The lock may have timed out and been released.`);
      }
    }
    
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Agent 任务结束时的批量释放
   */
  releaseAll(agentId: string): void {
    for (const [path, lock] of this.locks.entries()) {
      if (lock.ownerAgentId === agentId) {
        this.release(path, agentId);
      }
    }
  }

  /**
   * 返回冲突日志，供 Verifier 使用
   */
  getConflictLog(): ConflictRecord[] {
    return [...this.conflictLog];
  }

  /**
   * 检查文件当前是否被锁定
   */
  isLocked(filePath: string): boolean {
    return this.locks.has(this.normalizePath(filePath));
  }

  /**
   * 获取文件当前的锁信息
   */
  getLockInfo(filePath: string): FileLock | undefined {
    return this.locks.get(this.normalizePath(filePath));
  }

  /**
   * 获取写入历史（所有被写入过的文件及其 Agent 列表）
   */
  getWriteHistory(): Map<string, string[]> {
    return new Map(this.writeHistory);
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  private normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  private grantWriteLock(normalizedPath: string, agentId: string): void {
    this.locks.set(normalizedPath, {
      path: normalizedPath,
      ownerAgentId: agentId,
      mode: 'write',
      acquiredAt: Date.now(),
      reentryCount: 0,
    });

    // 设置超时计时器
    const timer = setTimeout(() => {
      const lock = this.locks.get(normalizedPath);
      if (lock && lock.ownerAgentId === agentId) {
        console.warn(
          `[FSLock] Write lock timeout for "${normalizedPath}" (agent: ${agentId}). Auto-releasing.`
        );
        this.release(normalizedPath, agentId);
      }
    }, this.config.timeoutMs);

    this.timeoutTimers.set(normalizedPath, timer);
  }

  private processQueue(normalizedPath: string): void {
    const queue = this.writeQueues.get(normalizedPath);
    if (!queue || queue.length === 0) return;

    // 取出队列头部
    const next = queue.shift()!;

    if (queue.length === 0) {
      this.writeQueues.delete(normalizedPath);
    }

    // 授予写锁
    this.grantWriteLock(normalizedPath, next.agentId);
    next.resolve();
  }
}

// 导出单例获取函数（便捷用法）
export const fslock = (): FileLockManager => FileLockManager.getInstance();
