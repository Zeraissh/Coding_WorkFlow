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
        warning: number;
        critical: number;
        exhaust: number;
    };
}
export interface BudgetEvent {
    type: 'warning' | 'critical' | 'exhausted' | 'rebalanced' | 'allocation';
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
    private agentFallbackSpent;
    private constructor();
    static getInstance(): TokenBudgetManager;
    configure(config: Partial<TokenBudgetConfig>): void;
    reset(): void;
    onBudgetEvent(listener: BudgetEventListener): void;
    /**
     * 按复杂度权重为子任务分配预算
     *
     * @param subtasks 子任务列表（含 estimatedComplexity）
     * @returns 每个子任务的预算分配
     */
    allocateForTasks(subtasks: Subtask[]): BudgetAllocation[];
    /**
     * Agent 每次 LLM 调用后上报 Token 消耗
     */
    reportUsage(agentId: string, tokensUsed: number): void;
    getUsage(agentId: string): number;
    /**
     * 检查 Agent 是否可以继续执行
     *
     * 应在 Agent 工具调用循环的每个 step 前调用。
     */
    checkBudget(agentId: string): BudgetCheck;
    /**
     * Agent 提前完成 → 释放剩余额度
     *
     * 在 Agent 报告任务完成时调用。
     */
    rebalance(completedAgentId: string): void;
    /**
     * 生成预算使用汇总报告
     */
    getReport(): BudgetReport;
    /**
     * 获取当前配置
     */
    getConfig(): TokenBudgetConfig;
    private emit;
}
export declare const tokenBudget: () => TokenBudgetManager;
export {};
//# sourceMappingURL=tokenBudget.d.ts.map