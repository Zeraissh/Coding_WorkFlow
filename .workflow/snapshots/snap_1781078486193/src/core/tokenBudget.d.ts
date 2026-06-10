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
import type { SubTask } from '../types/workflow';
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
        warning: number;
        critical: number;
        exhaust: number;
    };
}
export interface BudgetEvent {
    type: 'warning' | 'critical' | 'exhausted' | 'rebalanced' | 'allocation' | 'completed';
    timestamp: number;
    agentId?: string;
    subtaskId?: string;
    message: string;
    data?: Record<string, unknown>;
}
export type BudgetEventListener = (event: BudgetEvent) => void;
export declare class TokenBudgetManager {
    private static instance;
    private config;
    private budget;
    private allocations;
    private agentTaskMap;
    private listeners;
    private agentCallCounts;
    /** 已完成任务集合（用于报表状态判定） */
    private completedTasks;
    /** 当 budget 未初始化时的后备消耗追踪 */
    private agentFallbackSpent;
    private constructor();
    static getInstance(): TokenBudgetManager;
    /** 重置所有状态（主要用于测试） */
    static resetInstance(): void;
    configure(config: Partial<TokenBudgetConfig>): void;
    reset(): void;
    onBudgetEvent(listener: BudgetEventListener): void;
    /** 移除事件监听器 */
    offBudgetEvent(listener: BudgetEventListener): void;
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
    allocateForTasks(subtasks: Subtask[]): BudgetAllocation[];
    /**
     * Agent 每次 LLM 调用后上报 Token 消耗。
     *
     * 调用约定：
     * - 已分配的子任务 Agent：扣减该子任务配额 + 全局
     * - 未分配的 Agent（如 Orchestrator 自身）：扣减预留池
     */
    reportUsage(agentId: string, tokensUsed: number): void;
    /**
     * 查询 Agent 累计 Token 消耗（即使 budget 未初始化也能工作）
     */
    getUsage(agentId: string): number;
    /**
     * 检查 Agent 是否可以继续执行
     *
     * 应在 Agent 工具调用循环的每个 step 前调用。
     * 三级阈值：
     *  - warning  (默认 70%): 发送提醒，仍可继续
     *  - critical (默认 85%): 建议尽快输出结果
     *  - exhaust  (默认 95%): 强制终止
     */
    checkBudget(agentId: string): BudgetCheck;
    /**
     * 标记子任务完成。
     *
     * 由 Orchestrator 在收到 Agent 完成信号时调用。
     * 会自动触发 rebalance 释放剩余额度。
     */
    markCompleted(agentId: string): void;
    /**
     * Agent 提前完成 → 释放剩余额度给同批次活跃 Agent。
     *
     * 重分配策略：
     * 1. 计算完成 Agent 的剩余额度（已分配 - 已消耗）
     * 2. 找出同批次中未完成且未耗尽的活跃 Agent
     * 3. 按活跃 Agent 的剩余待分配额度比例分配 surplus
     * 4. 若没有活跃 Agent，将 surplus 加入 freePool（后续新 Agent 可用）
     */
    rebalance(completedAgentId: string): void;
    /**
     * 从自由池中为指定子任务追加预算。
     *
     * 使用场景：Agent 在 critical 阈值但尚未完成时，
     * Orchestrator 可主动从自由池拨款。
     *
     * @returns 实际追加的 token 数（可能小于请求值，取决于自由池余额）
     */
    requestExtraBudget(subtaskId: string, amount: number): number;
    /**
     * 生成预算使用汇总报告
     */
    getReport(): BudgetReport;
    /**
     * 获取当前配置（只读副本）
     */
    getConfig(): TokenBudgetConfig;
    /**
     * 查询某个子任务当前的预算分配详情
     */
    getTaskAllocation(subtaskId: string): BudgetAllocation | undefined;
    /**
     * 判断预算系统是否已初始化
     */
    isInitialized(): boolean;
    private emit;
}
export declare const tokenBudget: () => TokenBudgetManager;
export {};
//# sourceMappingURL=tokenBudget.d.ts.map