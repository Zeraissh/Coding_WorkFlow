/**
 * SemanticReviewer — LLM 语义审查阶段
 *
 * 在 AutoChecker 完成后，使用便宜模型对代码进行语义层面的审查：
 * - 逻辑错误（自动检查查不出的语义问题）
 * - 代码风格是否统一
 * - 异常处理是否完整
 * - 是否有冗余代码
 * - 安全隐患
 *
 * 设计原则：
 * - 使用比 Orchestrator/Agent 更便宜的模型
 * - 只审查变更文件，不扫描整个代码库
 * - 输出结构化结果，可量化
 */
import type { SemanticIssue, AutoCheckResult, AgentExecutionLog, VerifierConfig } from './types';
export interface SemanticReviewerDeps {
    /** LLM 调用（通常使用 haiku/flash 等便宜模型） */
    callLLM: (prompt: string, options?: {
        temperature?: number;
        maxTokens?: number;
    }) => Promise<string>;
}
export declare class SemanticReviewer {
    private config;
    private deps;
    constructor(deps: SemanticReviewerDeps, config: VerifierConfig);
    /**
     * 执行语义审查
     *
     * @param agentLogs Agent 执行日志
     * @param autoCheckResult 第一阶段自动检查结果
     * @returns 语义问题列表
     */
    review(agentLogs: AgentExecutionLog[], autoCheckResult?: AutoCheckResult): Promise<SemanticIssue[]>;
    private collectFileDiffs;
    private buildReviewPrompt;
    private parseReviewResponse;
}
/**
 * 生成人类可读的验证汇总
 */
export declare function generateSummary(autoCheck: AutoCheckResult, semanticIssues: SemanticIssue[], durationMs: number): string;
//# sourceMappingURL=semanticReviewer.d.ts.map