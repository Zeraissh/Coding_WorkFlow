export interface EvalRecord {
    timestamp: number;
    workflowId: string;
    totalTasks: number;
    successfulTasks: number;
    totalTokens: number;
    cachedTokens: number;
    totalLlmCalls: number;
    totalDurationMs: number;
    cacheHitRate: number;
    estimatedSavings: number;
    provider: string;
}
export declare class Evaluator {
    private logFile;
    private records;
    private currentWorkflowId;
    private currentStats;
    constructor(cwd?: string);
    private loadLogs;
    private saveLogs;
    private setupListeners;
    calculateRetentionScore(): number;
    getLogs(): {
        records: EvalRecord[];
        retentionScore: number;
    };
}
//# sourceMappingURL=evaluator.d.ts.map