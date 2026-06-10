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
    timeoutMs: number;
}
export declare class FileLockManager {
    private static instance;
    /** 当前持有的锁: filePath → FileLock */
    private locks;
    /** 等待队列: filePath → 排队中的写请求列表 */
    private writeQueues;
    /** 冲突日志: 被多个 Agent 写入的文件记录 */
    private conflictLog;
    /** 每个文件的写入历史: filePath → [agentId, ...] */
    private writeHistory;
    /** 活跃超时计时器: filePath → Timer */
    private timeoutTimers;
    /** 全局开关 */
    private config;
    private constructor();
    /** 获取单例 */
    static getInstance(): FileLockManager;
    /** 更新配置 */
    configure(config: Partial<FSLockConfig>): void;
    /** 重置（测试用） */
    reset(): void;
    /**
     * 获取写锁（互斥）
     *
     * - 如果文件未被锁定 → 立即获得锁
     * - 如果文件已被其他 Agent 持有锁 → 进入等待队列
     * - 同一 Agent 重复请求同一文件 → 直接返回（重入）
     */
    acquireWrite(filePath: string, agentId: string): Promise<void>;
    /**
     * 获取读锁（共享，不阻塞）
     *
     * 读锁不互斥，但记录访问者供冲突检测使用。
     */
    acquireRead(filePath: string, agentId: string): Promise<void>;
    /**
     * 释放锁
     */
    release(filePath: string, agentId: string): void;
    /**
     * 同步安全写入封装
     * 确保执行底层写入的那一刻，Agent 仍然实际持有锁（防止超时剥夺引发脏写）
     */
    writeFile(filePath: string, agentId: string, content: string): void;
    /**
     * Agent 任务结束时的批量释放
     */
    releaseAll(agentId: string): void;
    /**
     * 返回冲突日志，供 Verifier 使用
     */
    getConflictLog(): ConflictRecord[];
    /**
     * 检查文件当前是否被锁定
     */
    isLocked(filePath: string): boolean;
    /**
     * 获取文件当前的锁信息
     */
    getLockInfo(filePath: string): FileLock | undefined;
    /**
     * 获取写入历史（所有被写入过的文件及其 Agent 列表）
     */
    getWriteHistory(): Map<string, string[]>;
    private normalizePath;
    private grantWriteLock;
    private processQueue;
}
export declare const fslock: () => FileLockManager;
//# sourceMappingURL=fslock.d.ts.map