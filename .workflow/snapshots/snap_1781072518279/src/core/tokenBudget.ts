/**
 * TokenBudgetManager — Token 预算追踪与智能分配
 *
 * 解决多 Agent 并发场景下的 API 成本不可控问题。
 *
 * 核心能力：
 * 1. 按子任务复杂度权重分配 Token 预算
 * 2. 运行时实时追踪每个 Agent 的消耗
 * 3. 三级阈值告警 (70% 提醒 / 85% 截断输出 / 95% 强制终止)
 * 4. 动态重分配（Agent 提前完工 → 释放额度给同批次 Agent）
 * 5. 预留 buffer 给 Orchestrator + Verifier 自身
 *
 * 设计原则：
 * - 预算用尽时优雅终止而非崩溃
 * - 已有结果不丢失（传给 Verifier）
 * - 开销极小（纯内存操作）
 */

// ============================================================================
// Types
// ============================================================================

import type { SubTask } from '../types/workflow';

// 适配实际项目类型
type Subtask = SubTask;

/** 预算级别 */
export type BudgetLevel = 'normal' | 'warning' | 'critical' | 'exhausted';

export interface TokenBudget {
  /** 全局总预算 */
  total: number;
  /** 已消耗总量（含所有 Agent + 预留池使用） */
  spent: number;
  /** 每个子任务 ID → 已分配额度 */
  allocated: Map<string, number>;
  /** 每个子任务 ID → 实际已消耗 */
  taskSpent: Map<string, number>;
  /** 每个 Agent ID → 实际已消耗 */
  agentSpent: Map<string, number>;
  /** 分配给 Orchestrator 和 Verifier 的预留量 */
  reserved: number;
  /** 预留池已使用量（由 Orchestrator / Verifier 消耗） */
  reservedSpent: number;
  /** 已完成任务的剩余额度释放池（可重分配给活跃任务） */
  freePool: number;
}

export interface BudgetAllocation {
  agentId: string;
  subtaskId: string;
  allocatedTokens: number;
  /** 70% — 发提醒 */
  warningThreshold: number;
  /** 85% — 截断输出 */
  criticalThreshold: number;
  /** 95% — 强制终止 */
  exhaustThreshold: number;
}

export interface BudgetCheck {
  canContinue: boolean;
  level: BudgetLevel;
  remaining: number;
  allocated: number;
  spent: number;
  warning?: string | undefined;
}

export interface BudgetReport {
  totalBudget: number;
  totalSpent: number;
  reservedTotal: number;
  reservedSpent: number;
  reservedRemaining: number;
  freePool: number;
  tasksBreakdown: {
    subtaskId: string;
    allocated: number;
    spent: number;
    percentUsed: number;
    status: 'active' | 'completed' | 'exhausted';
  }[];
  agentsBreakdown: {
    agentId: string;
    spent: number;
    llmCalls: number;
  }[];
  overallPercentUsed: number;
}

export interface TokenBudgetConfig {
  enabled: boolean;
  /** 全局总预算 (默认 500_000) */
  totalTokens: number;
  /** 是否启用动态重分配 */
  autoRebalance: boolean;
  /** Verifier + Orchestrator 预留百分比 (默认 10%) */
  verifierReservePercent: number;
  /** 告警阈值百分比 */
  thresholds: {
    warning: number;   // 默认 0.70
    critical: number;  // 默认 0.85
    exhaust: number;   // 默认 0.95
  };
}

// ============================================================================
// BudgetEventListener
// ============================================================================

export interface BudgetEvent {
  type: 'warning' | 'critical' | 'exhausted' | 'rebalanced' | 'allocation' | 'completed';
  timestamp: number;
  agentId?: string;
  subtaskId?: string;
  message: string;
  data?: Record<string, unknown>;
}

export type BudgetEventListener = (event: BudgetEvent) => void;

// ============================================================================
// TokenBudgetManager
// ============================================================================

const DEFAULT_CONFIG: TokenBudgetConfig = {
  enabled: true,
  totalTokens: 500_000,
  autoRebalance: true,
  verifierReservePercent: 10,
  thresholds: {
    warning: 0.70,
    critical: 0.85,
    exhaust: 0.95,
  },
};

/** 重分配时忽略低于此阈值的剩余额度 */
const MIN_SURPLUS_FOR_REBALANCE = 500;

export class TokenBudgetManager {
  private static instance: TokenBudgetManager;

  private config: TokenBudgetConfig = { ...DEFAULT_CONFIG };
  private budget: TokenBudget | null = null;
  private allocations: Map<string, BudgetAllocation> = new Map(); // subtaskId → allocation
  private agentTaskMap: Map<string, string> = new Map(); // agentId → subtaskId
  private listeners: BudgetEventListener[] = [];
  private agentCallCounts: Map<string, number> = new Map();
  /** 已完成任务集合（用于报表状态判定） */
  private completedTasks: Set<string> = new Set();
  /** 当 budget 未初始化时的后备消耗追踪 */
  private agentFallbackSpent: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): TokenBudgetManager {
    if (!TokenBudgetManager.instance) {
      TokenBudgetManager.instance = new TokenBudgetManager();
    }
    return TokenBudgetManager.instance;
  }

  /** 重置所有状态（主要用于测试） */
  static resetInstance(): void {
    TokenBudgetManager.instance = undefined as unknown as TokenBudgetManager;
  }

  configure(config: Partial<TokenBudgetConfig>): void {
    this.config = { ...this.config, ...config };
    if (config.thresholds) {
      this.config.thresholds = { ...DEFAULT_CONFIG.thresholds, ...config.thresholds };
    }
  }

  reset(): void {
    this.budget = null;
    this.allocations.clear();
    this.agentTaskMap.clear();
    this.listeners = [];
    this.agentCallCounts.clear();
    this.agentFallbackSpent.clear();
    this.completedTasks.clear();
  }

  onBudgetEvent(listener: BudgetEventListener): void {
    this.listeners.push(listener);
  }

  /** 移除事件监听器 */
  offBudgetEvent(listener: BudgetEventListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx !== -1) this.listeners.splice(idx, 1);
  }

  // ==========================================================================
  // 公共 API — 分配阶段（Orchestrator 调用）
  // ==========================================================================

  /**
   * 按复杂度权重为子任务分配预算
   *
   * 算法：
   *   1. 从 totalTokens 中扣除 verifierReservePercent 作为预留池
   *   2. 剩余部分为 allocatablePool
   *   3. 按每个子任务的 estimatedComplexity（默认 5）占总复杂度的比例分配
   *
   * @param subtasks 子任务列表（含 estimatedComplexity）
   * @returns 每个子任务的预算分配
   */
  allocateForTasks(subtasks: Subtask[]): BudgetAllocation[] {
    if (!this.config.enabled || subtasks.length === 0) {
      return [];
    }

    const totalBudget = this.config.totalTokens;
    const reserveRatio = this.config.verifierReservePercent / 100;
    const reserved = Math.floor(totalBudget * reserveRatio);
    const allocatablePool = totalBudget - reserved;

    // 计算总复杂度（默认值 5）
    const totalComplexity = subtasks.reduce(
      (sum, t) => sum + (t.estimatedComplexity && t.estimatedComplexity > 0 ? t.estimatedComplexity : 5),
      0
    );

    if (totalComplexity <= 0) {
      // 理论上不会发生，但做保护
      return [];
    }

    // 按权重分配
    const allocations: BudgetAllocation[] = subtasks.map((task, index) => {
      const complexity = task.estimatedComplexity && task.estimatedComplexity > 0
        ? task.estimatedComplexity
        : 5;
      const weight = complexity / totalComplexity;
      const allocated = Math.max(1, Math.floor(allocatablePool * weight));
      const agentId = `agent-${index}-${task.id}`;

      const allocation: BudgetAllocation = {
        agentId,
        subtaskId: task.id,
        allocatedTokens: allocated,
        warningThreshold: Math.floor(allocated * this.config.thresholds.warning),
        criticalThreshold: Math.floor(allocated * this.config.thresholds.critical),
        exhaustThreshold: Math.floor(allocated * this.config.thresholds.exhaust),
      };

      this.allocations.set(task.id, allocation);
      this.agentTaskMap.set(agentId, task.id);
      this.agentCallCounts.set(agentId, 0);

      return allocation;
    });

    // 处理浮点误差：将分配后剩余的零头加到最后一个任务
    const totalAllocated = allocations.reduce((s, a) => s + a.allocatedTokens, 0);
    const roundingError = allocatablePool - totalAllocated;
    if (roundingError > 0 && allocations.length > 0) {
      const last = allocations[allocations.length - 1]!;
      last.allocatedTokens += roundingError;
      last.warningThreshold = Math.floor(last.allocatedTokens * this.config.thresholds.warning);
      last.criticalThreshold = Math.floor(last.allocatedTokens * this.config.thresholds.critical);
      last.exhaustThreshold = Math.floor(last.allocatedTokens * this.config.thresholds.exhaust);
      // 同步更新 Map
      this.allocations.get(last.subtaskId)!.allocatedTokens = last.allocatedTokens;
    }

    // 初始化预算
    this.budget = {
      total: totalBudget,
      spent: 0,
      allocated: new Map(subtasks.map((t, i) => [t.id, allocations[i]!.allocatedTokens])),
      taskSpent: new Map(subtasks.map((t) => [t.id, 0])),
      agentSpent: new Map(allocations.map((a) => [a.agentId, 0])),
      reserved,
      reservedSpent: 0,
      freePool: 0,
    };

    this.emit({
      type: 'allocation',
      timestamp: Date.now(),
      message: `预算分配完成: ${allocatablePool.toLocaleString()} tokens 分配给 ${subtasks.length} 个子任务, ${reserved.toLocaleString()} reserved`,
      data: {
        totalBudget,
        allocatablePool,
        reserved,
        allocations: allocations.map((a) => ({
          subtaskId: a.subtaskId,
          allocated: a.allocatedTokens,
        })),
      },
    });

    return allocations;
  }

  // ==========================================================================
  // 公共 API — 运行时追踪（Agent 每次 LLM 调用后调用）
  // ==========================================================================

  /**
   * Agent 每次 LLM 调用后上报 Token 消耗。
   *
   * 调用约定：
   * - 已分配的子任务 Agent：扣减该子任务配额 + 全局
   * - 未分配的 Agent（如 Orchestrator 自身）：扣减预留池
   */
  reportUsage(agentId: string, tokensUsed: number): void {
    // 始终记录后备消耗（用于 getUsage 查询）
    this.agentFallbackSpent.set(
      agentId,
      (this.agentFallbackSpent.get(agentId) || 0) + tokensUsed
    );

    if (!this.config.enabled || !this.budget) return;

    const subtaskId = this.agentTaskMap.get(agentId);
    if (!subtaskId) {
      // 非托管 Agent（如 Orchestrator 自身）→ 扣预留池 + 全局
      this.budget.spent += tokensUsed;
      this.budget.reservedSpent += tokensUsed;
      return;
    }

    // 更新计数器
    this.budget.spent += tokensUsed;
    this.budget.taskSpent.set(
      subtaskId,
      (this.budget.taskSpent.get(subtaskId) || 0) + tokensUsed
    );
    this.budget.agentSpent.set(
      agentId,
      (this.budget.agentSpent.get(agentId) || 0) + tokensUsed
    );
    this.agentCallCounts.set(
      agentId,
      (this.agentCallCounts.get(agentId) || 0) + 1
    );
  }

  /**
   * 查询 Agent 累计 Token 消耗（即使 budget 未初始化也能工作）
   */
  getUsage(agentId: string): number {
    return this.agentFallbackSpent.get(agentId) || 0;
  }

  /**
   * 检查 Agent 是否可以继续执行
   *
   * 应在 Agent 工具调用循环的每个 step 前调用。
   * 三级阈值：
   *  - warning  (默认 70%): 发送提醒，仍可继续
   *  - critical (默认 85%): 建议尽快输出结果
   *  - exhaust  (默认 95%): 强制终止
   */
  checkBudget(agentId: string): BudgetCheck {
    if (!this.config.enabled || !this.budget) {
      return {
        canContinue: true,
        level: 'normal',
        remaining: Infinity,
        allocated: 0,
        spent: 0,
      };
    }

    const subtaskId = this.agentTaskMap.get(agentId);
    if (!subtaskId) {
      // 非托管 Agent — 只检查全局预算
      if (this.budget.spent >= this.budget.total) {
        return {
          canContinue: false,
          level: 'exhausted',
          remaining: 0,
          allocated: 0,
          spent: this.budget.spent,
          warning: '全局预算已耗尽',
        };
      }
      return {
        canContinue: true,
        level: 'normal',
        remaining: this.budget.total - this.budget.spent,
        allocated: 0,
        spent: this.budget.spent,
      };
    }

    const allocation = this.allocations.get(subtaskId);
    if (!allocation) {
      return {
        canContinue: true,
        level: 'normal',
        remaining: this.budget.total - this.budget.spent,
        allocated: 0,
        spent: 0,
      };
    }

    const spent = this.budget.taskSpent.get(subtaskId) || 0;
    const remaining = Math.max(0, allocation.allocatedTokens - spent);
    const percentUsed = allocation.allocatedTokens > 0
      ? spent / allocation.allocatedTokens
      : 1;

    let level: BudgetLevel = 'normal';
    let warning: string | undefined;

    if (percentUsed >= this.config.thresholds.exhaust) {
      level = 'exhausted';
      warning = `子任务 ${subtaskId} 预算耗尽 (${(percentUsed * 100).toFixed(0)}%)，强制终止`;
      this.emit({
        type: 'exhausted',
        timestamp: Date.now(),
        agentId,
        subtaskId,
        message: warning,
        data: { spent, allocated: allocation.allocatedTokens, percentUsed },
      });
    } else if (percentUsed >= this.config.thresholds.critical) {
      level = 'critical';
      warning = `子任务 ${subtaskId} 预算告急 (${(percentUsed * 100).toFixed(0)}%)，请尽快输出结果`;
      this.emit({
        type: 'critical',
        timestamp: Date.now(),
        agentId,
        subtaskId,
        message: warning,
        data: { spent, allocated: allocation.allocatedTokens, percentUsed },
      });
    } else if (percentUsed >= this.config.thresholds.warning) {
      level = 'warning';
      warning = `子任务 ${subtaskId} 已使用 ${(percentUsed * 100).toFixed(0)}% 预算，请节约使用`;
      this.emit({
        type: 'warning',
        timestamp: Date.now(),
        agentId,
        subtaskId,
        message: warning,
        data: { spent, allocated: allocation.allocatedTokens, percentUsed },
      });
    }

    return {
      canContinue: level !== 'exhausted',
      level,
      remaining,
      allocated: allocation.allocatedTokens,
      spent,
      warning,
    };
  }

  /**
   * 标记子任务完成。
   *
   * 由 Orchestrator 在收到 Agent 完成信号时调用。
   * 会自动触发 rebalance 释放剩余额度。
   */
  markCompleted(agentId: string): void {
    const subtaskId = this.agentTaskMap.get(agentId);
    if (subtaskId) {
      this.completedTasks.add(subtaskId);
      this.emit({
        type: 'completed',
        timestamp: Date.now(),
        agentId,
        subtaskId,
        message: `子任务 ${subtaskId} 已完成`,
      });
    }

    // 自动触发重分配
    if (this.config.autoRebalance) {
      this.rebalance(agentId);
    }
  }

  // ==========================================================================
  // 公共 API — 动态重分配
  // ==========================================================================

  /**
   * Agent 提前完成 → 释放剩余额度给同批次活跃 Agent。
   *
   * 重分配策略：
   * 1. 计算完成 Agent 的剩余额度（已分配 - 已消耗）
   * 2. 找出同批次中未完成且未耗尽的活跃 Agent
   * 3. 按活跃 Agent 的剩余待分配额度比例分配 surplus
   * 4. 若没有活跃 Agent，将 surplus 加入 freePool（后续新 Agent 可用）
   */
  rebalance(completedAgentId: string): void {
    if (!this.config.enabled || !this.config.autoRebalance || !this.budget) return;

    const subtaskId = this.agentTaskMap.get(completedAgentId);
    if (!subtaskId) return;

    const allocation = this.allocations.get(subtaskId);
    if (!allocation) return;

    const spent = this.budget.taskSpent.get(subtaskId) || 0;
    const surplus = allocation.allocatedTokens - spent;

    // 剩余太少不值得重分配
    if (surplus < MIN_SURPLUS_FOR_REBALANCE) return;

    // 找出还活跃的其他子任务
    const activeAllocations = Array.from(this.allocations.entries())
      .filter(([id]) => {
        if (id === subtaskId) return false;
        if (this.completedTasks.has(id)) return false;
        const s = this.budget!.taskSpent.get(id) || 0;
        const a = this.budget!.allocated.get(id) || 0;
        // 未耗尽（< 90%）且未完成
        return a > 0 && s < a * this.config.thresholds.critical;
      })
      .map(([id, alloc]) => ({ subtaskId: id, allocation: alloc }));

    if (activeAllocations.length === 0) {
      // 没有活跃的子任务 → 加入自由池（可被后续任务或 Verifier 使用）
      this.budget.freePool += surplus;
      this.emit({
        type: 'rebalanced',
        timestamp: Date.now(),
        agentId: completedAgentId,
        subtaskId,
        message: `${surplus.toLocaleString()} tokens 加入自由池（无活跃任务可分配）`,
        data: { surplus, freePool: this.budget.freePool, returned: true },
      });
      return;
    }

    // 计算所有活跃 Agent 当前的剩余额度总和（用于按比例分配）
    const totalRemainingAlloc = activeAllocations.reduce((sum, { subtaskId: id, allocation: targetAlloc }) => {
      const s = this.budget!.taskSpent.get(id) || 0;
      return sum + Math.max(0, targetAlloc.allocatedTokens - s);
    }, 0);

    if (totalRemainingAlloc <= 0) {
      // 所有活跃任务额度都已耗尽 → 加入自由池
      this.budget.freePool += surplus;
      return;
    }

    // 按剩余额度比例分配 surplus
    let distributedTotal = 0;
    for (const { subtaskId: targetId, allocation: targetAlloc } of activeAllocations) {
      const s = this.budget!.taskSpent.get(targetId) || 0;
      const remaining = Math.max(0, targetAlloc.allocatedTokens - s);
      const proportion = remaining / totalRemainingAlloc;
      const bonus = Math.floor(surplus * proportion);

      if (bonus <= 0) continue;

      const newAllocated = targetAlloc.allocatedTokens + bonus;
      targetAlloc.allocatedTokens = newAllocated;
      targetAlloc.warningThreshold = Math.floor(newAllocated * this.config.thresholds.warning);
      targetAlloc.criticalThreshold = Math.floor(newAllocated * this.config.thresholds.critical);
      targetAlloc.exhaustThreshold = Math.floor(newAllocated * this.config.thresholds.exhaust);

      this.budget!.allocated.set(targetId, newAllocated);
      distributedTotal += bonus;
    }

    // 分配后可能还有零头 → 加入自由池
    const remainder = surplus - distributedTotal;
    if (remainder > 0) {
      this.budget.freePool += remainder;
    }

    this.emit({
      type: 'rebalanced',
      timestamp: Date.now(),
      agentId: completedAgentId,
      subtaskId,
      message: `${surplus.toLocaleString()} surplus tokens → ${distributedTotal.toLocaleString()} 分配给 ${activeAllocations.length} 个活跃任务${remainder > 0 ? `（${remainder} 入自由池）` : ''}`,
      data: { surplus, distributed: distributedTotal, remainder, recipientCount: activeAllocations.length },
    });
  }

  /**
   * 从自由池中为指定子任务追加预算。
   *
   * 使用场景：Agent 在 critical 阈值但尚未完成时，
   * Orchestrator 可主动从自由池拨款。
   *
   * @returns 实际追加的 token 数（可能小于请求值，取决于自由池余额）
   */
  requestExtraBudget(subtaskId: string, amount: number): number {
    if (!this.budget || this.budget.freePool <= 0) return 0;

    const allocation = this.allocations.get(subtaskId);
    if (!allocation) return 0;

    const granted = Math.min(amount, this.budget.freePool);
    this.budget.freePool -= granted;

    allocation.allocatedTokens += granted;
    allocation.warningThreshold = Math.floor(allocation.allocatedTokens * this.config.thresholds.warning);
    allocation.criticalThreshold = Math.floor(allocation.allocatedTokens * this.config.thresholds.critical);
    allocation.exhaustThreshold = Math.floor(allocation.allocatedTokens * this.config.thresholds.exhaust);

    this.budget.allocated.set(subtaskId, allocation.allocatedTokens);

    this.emit({
      type: 'rebalanced',
      timestamp: Date.now(),
      subtaskId,
      message: `从自由池拨款 ${granted.toLocaleString()} tokens 给 ${subtaskId}`,
      data: { granted, freePoolRemaining: this.budget.freePool },
    });

    return granted;
  }

  // ==========================================================================
  // 公共 API — 报表
  // ==========================================================================

  /**
   * 生成预算使用汇总报告
   */
  getReport(): BudgetReport {
    if (!this.budget) {
      return {
        totalBudget: 0,
        totalSpent: 0,
        reservedTotal: 0,
        reservedSpent: 0,
        reservedRemaining: 0,
        freePool: 0,
        tasksBreakdown: [],
        agentsBreakdown: [],
        overallPercentUsed: 0,
      };
    }

    const tasksBreakdown = Array.from(this.allocations.entries()).map(
      ([subtaskId, allocation]) => {
        const spent = this.budget!.taskSpent.get(subtaskId) || 0;
        const percentUsed = allocation.allocatedTokens > 0
          ? spent / allocation.allocatedTokens
          : 0;
        let status: 'active' | 'completed' | 'exhausted' = 'active';
        if (this.completedTasks.has(subtaskId)) {
          status = 'completed';
        } else if (percentUsed >= this.config.thresholds.exhaust) {
          status = 'exhausted';
        }

        return { subtaskId, allocated: allocation.allocatedTokens, spent, percentUsed, status };
      }
    );

    const agentsBreakdown = Array.from(this.agentCallCounts.entries())
      .filter(([, llmCalls]) => llmCalls > 0)
      .map(([agentId, llmCalls]) => ({
        agentId,
        spent: this.budget!.agentSpent.get(agentId) || 0,
        llmCalls,
      }));

    const reservedRemaining = Math.max(0, this.budget.reserved - this.budget.reservedSpent);

    return {
      totalBudget: this.budget.total,
      totalSpent: this.budget.spent,
      reservedTotal: this.budget.reserved,
      reservedSpent: this.budget.reservedSpent,
      reservedRemaining,
      freePool: this.budget.freePool,
      tasksBreakdown,
      agentsBreakdown,
      overallPercentUsed: this.budget.total > 0
        ? this.budget.spent / this.budget.total
        : 0,
    };
  }

  /**
   * 获取当前配置（只读副本）
   */
  getConfig(): TokenBudgetConfig {
    return { ...this.config, thresholds: { ...this.config.thresholds } };
  }

  /**
   * 查询某个子任务当前的预算分配详情
   */
  getTaskAllocation(subtaskId: string): BudgetAllocation | undefined {
    const alloc = this.allocations.get(subtaskId);
    return alloc ? { ...alloc } : undefined;
  }

  /**
   * 判断预算系统是否已初始化
   */
  isInitialized(): boolean {
    return this.budget !== null;
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  private emit(event: BudgetEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 静默吞掉监听器异常，避免影响主流程
      }
    }
  }
}

// 导出单例获取函数
export const tokenBudget = (): TokenBudgetManager => TokenBudgetManager.getInstance();
