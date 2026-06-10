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
  /** 已消耗总量 */
  spent: number;
  /** 每个子任务 ID → 已分配额度 */
  allocated: Map<string, number>;
  /** 每个子任务 ID → 实际已消耗 */
  taskSpent: Map<string, number>;
  /** 每个 Agent ID → 实际已消耗 */
  agentSpent: Map<string, number>;
  /** 分配给 Orchestrator 和 Verifier 的预留量 */
  reserved: number;
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
  reservedRemaining: number;
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
  type: 'warning' | 'critical' | 'exhausted' | 'rebalanced' | 'allocation';
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

export class TokenBudgetManager {
  private static instance: TokenBudgetManager;

  private config: TokenBudgetConfig = { ...DEFAULT_CONFIG };
  private budget: TokenBudget | null = null;
  private allocations: Map<string, BudgetAllocation> = new Map(); // subtaskId → allocation
  private agentTaskMap: Map<string, string> = new Map(); // agentId → subtaskId
  private listeners: BudgetEventListener[] = [];
  private agentCallCounts: Map<string, number> = new Map();
  private agentFallbackSpent: Map<string, number> = new Map();

  private constructor() {}

  static getInstance(): TokenBudgetManager {
    if (!TokenBudgetManager.instance) {
      TokenBudgetManager.instance = new TokenBudgetManager();
    }
    return TokenBudgetManager.instance;
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
  }

  onBudgetEvent(listener: BudgetEventListener): void {
    this.listeners.push(listener);
  }

  // ==========================================================================
  // 公共 API — 分配阶段（Orchestrator 调用）
  // ==========================================================================

  /**
   * 按复杂度权重为子任务分配预算
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

    // 计算总复杂度
    const totalComplexity = subtasks.reduce(
      (sum, t) => sum + (t.estimatedComplexity || 5),
      0
    );

    // 按权分配
    const allocations: BudgetAllocation[] = subtasks.map((task, index) => {
      const weight = (task.estimatedComplexity || 5) / totalComplexity;
      const allocated = Math.floor(allocatablePool * weight);
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

    // 初始化预算
    this.budget = {
      total: totalBudget,
      spent: 0,
      allocated: new Map(subtasks.map((t, i) => [t.id, allocations[i]!.allocatedTokens])),
      taskSpent: new Map(subtasks.map((t) => [t.id, 0])),
      agentSpent: new Map(allocations.map((a) => [a.agentId, 0])),
      reserved,
    };

    this.emit({
      type: 'allocation',
      timestamp: Date.now(),
      message: `预算分配完成: ${allocatablePool.toLocaleString()} tokens 分配给 ${subtasks.length} 个子任务, ${reserved.toLocaleString()} reserved`,
      data: {
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
   * Agent 每次 LLM 调用后上报 Token 消耗
   */
  reportUsage(agentId: string, tokensUsed: number): void {
    this.agentFallbackSpent.set(agentId, (this.agentFallbackSpent.get(agentId) || 0) + tokensUsed);
    
    if (!this.config.enabled || !this.budget) return;

    const subtaskId = this.agentTaskMap.get(agentId);
    if (!subtaskId) {
      // 非托管 Agent（如 Orchestrator 自身）→ 只扣全局
      this.budget.spent += tokensUsed;
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
    this.agentCallCounts.set(agentId, (this.agentCallCounts.get(agentId) || 0) + 1);
  }

  getUsage(agentId: string): number {
    return this.agentFallbackSpent.get(agentId) || 0;
  }

  /**
   * 检查 Agent 是否可以继续执行
   *
   * 应在 Agent 工具调用循环的每个 step 前调用。
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
      // 非托管 Agent — 只检查全局
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
    const remaining = allocation.allocatedTokens - spent;
    const percentUsed = spent / allocation.allocatedTokens;

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

  // ==========================================================================
  // 公共 API — 动态重分配
  // ==========================================================================

  /**
   * Agent 提前完成 → 释放剩余额度
   *
   * 在 Agent 报告任务完成时调用。
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
    if (surplus < 1000) return;

    // 找出同批次中还活跃的其他子任务
    const activeAllocations = Array.from(this.allocations.entries())
      .filter(([id]) => {
        const s = this.budget!.taskSpent.get(id) || 0;
        const a = this.budget!.allocated.get(id) || 0;
        return id !== subtaskId && s < a * 0.9; // 未完成且未耗尽
      })
      .map(([id, alloc]) => ({ subtaskId: id, allocation: alloc }));

    if (activeAllocations.length === 0) {
      // 没有活跃的子任务 → 返还给全局预算（给 Verifier）
      this.emit({
        type: 'rebalanced',
        timestamp: Date.now(),
        agentId: completedAgentId,
        subtaskId,
        message: `${surplus.toLocaleString()} tokens 返还全局预算`,
        data: { surplus, returned: true },
      });
      return;
    }

    // 计算所有活跃 Agent 剩余的待分配额度总和
    const totalRemainingAlloc = activeAllocations.reduce((sum, { subtaskId: id, allocation: targetAlloc }) => {
      const s = this.budget!.taskSpent.get(id) || 0;
      return sum + Math.max(0, targetAlloc.allocatedTokens - s);
    }, 0);

    if (totalRemainingAlloc <= 0) return; // 理论上不会发生，但防止除零

    // 按剩余额度比例分配 surplus
    for (const { subtaskId: targetId, allocation: targetAlloc } of activeAllocations) {
      const s = this.budget!.taskSpent.get(targetId) || 0;
      const remaining = Math.max(0, targetAlloc.allocatedTokens - s);
      const proportion = remaining / totalRemainingAlloc;
      const bonus = Math.floor(surplus * proportion);

      const newAllocated = targetAlloc.allocatedTokens + bonus;
      targetAlloc.allocatedTokens = newAllocated;
      targetAlloc.warningThreshold = Math.floor(newAllocated * this.config.thresholds.warning);
      targetAlloc.criticalThreshold = Math.floor(newAllocated * this.config.thresholds.critical);
      targetAlloc.exhaustThreshold = Math.floor(newAllocated * this.config.thresholds.exhaust);

      this.budget!.allocated.set(targetId, newAllocated);
    }

    this.emit({
      type: 'rebalanced',
      timestamp: Date.now(),
      agentId: completedAgentId,
      subtaskId,
      message: `${surplus.toLocaleString()} surplus tokens → 按比例分配给 ${activeAllocations.length} 个活跃Agent`,
      data: { surplus, recipientCount: activeAllocations.length },
    });
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
        reservedRemaining: 0,
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
        if (percentUsed >= this.config.thresholds.exhaust) status = 'exhausted';
        else if (spent > 0 && percentUsed < 1) status = 'completed';

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

    return {
      totalBudget: this.budget.total,
      totalSpent: this.budget.spent,
      reservedRemaining: this.budget.reserved - this.budget.spent,
      tasksBreakdown,
      agentsBreakdown,
      overallPercentUsed: this.budget.total > 0
        ? this.budget.spent / this.budget.total
        : 0,
    };
  }

  /**
   * 获取当前配置
   */
  getConfig(): TokenBudgetConfig {
    return { ...this.config };
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  private emit(event: BudgetEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // 静默吞掉监听器异常
      }
    }
  }
}

// 导出单例获取函数
export const tokenBudget = (): TokenBudgetManager => TokenBudgetManager.getInstance();
