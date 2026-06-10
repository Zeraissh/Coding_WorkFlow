/**
 * Verifier 校验相关类型定义
 */
export interface LintError {
    file: string;
    line: number;
    column?: number;
    message: string;
    rule?: string;
}
export interface TypeError {
    file: string;
    line?: number;
    message: string;
    code?: number;
}
export interface TestResults {
    passed: number;
    failed: number;
    skipped?: number;
    output: string;
    duration?: number;
}
export interface FileConflict {
    file: string;
    agents: string[];
    action: 'merged' | 'last_write_wins' | 'manual_resolve';
}
export interface InterfaceMismatch {
    fileA: string;
    fileB: string;
    kind: 'import_missing' | 'type_mismatch' | 'export_missing' | 'signature_mismatch';
    detail: string;
    suggestion?: string;
}
export interface AutoCheckResult {
    stage: 'auto';
    lintErrors: LintError[];
    typeErrors: TypeError[];
    testResults: TestResults | null;
    fileConflicts: FileConflict[];
    interfaceMismatches: InterfaceMismatch[];
    /** 所有自动检查是否全部通过 */
    passed: boolean;
    /** 自动修复的建议 */
    autoFixSuggestions: string[];
}
export interface SemanticIssue {
    severity: 'critical' | 'warning' | 'style';
    file: string;
    line?: number;
    description: string;
    suggestion: string;
    category: 'logic' | 'error_handling' | 'style' | 'redundancy' | 'security' | 'performance';
}
export interface VerificationResult {
    autoCheck: AutoCheckResult;
    semanticIssues: SemanticIssue[];
    finalVerdict: 'pass' | 'pass_with_warnings' | 'fail';
    /** 合并后的文件映射: path → content */
    mergedFiles: Map<string, string>;
    /** 人类可读的汇总 */
    summary: string;
    /** 执行总耗时 ms */
    durationMs: number;
}
export interface VerifierConfig {
    autoCheck: boolean;
    semanticReview: boolean;
    autoFix: boolean;
    /** 语义审查使用的模型（通常比主任务模型便宜） */
    reviewModel?: string;
}
export declare const DEFAULT_VERIFIER_CONFIG: VerifierConfig;
export interface AgentFileOp {
    agentId: string;
    subtaskId: string;
    operation: 'write' | 'read' | 'delete';
    filePath: string;
    content?: string;
    timestamp: number;
}
export interface AgentExecutionLog {
    agentId: string;
    subtaskId: string;
    files: AgentFileOp[];
    shellCommands: string[];
    llmCalls: number;
    tokensUsed: number;
    errors: string[];
}
//# sourceMappingURL=types.d.ts.map