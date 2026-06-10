export interface OrchestratorModuleConfig {
    maxSubtasks: number;
    minComplexityForSplit: number;
    enableSelfCheck: boolean;
    fewShotCategory: 'general' | 'code' | 'bugfix' | 'auto';
}
export interface VerifierModuleConfig {
    autoCheck: boolean;
    semanticReview: boolean;
    autoFix: boolean;
    reviewModel?: string;
}
export interface FSLockModuleConfig {
    enabled: boolean;
    timeoutMs: number;
}
export interface BudgetModuleConfig {
    enabled: boolean;
    totalTokens: number;
    autoRebalance: boolean;
    verifierReservePercent: number;
    thresholds: {
        warning: number;
        critical: number;
        exhaust: number;
    };
}
export interface WorkflowConfig {
    requireApproval: boolean;
    provider: 'anthropic' | 'deepseek' | 'openai';
    model: string;
    apiKey: string;
    reasoningEffort: 'none' | 'high' | 'max';
    /** Orchestrator 拆解增强配置 */
    orchestratorConfig?: Partial<OrchestratorModuleConfig>;
    /** Verifier 两阶段校验配置 */
    verifierConfig?: Partial<VerifierModuleConfig>;
    /** 文件锁配置 */
    fslockConfig?: Partial<FSLockModuleConfig>;
    /** Token 预算配置 */
    budgetConfig?: Partial<BudgetModuleConfig>;
}
declare class ConfigManager {
    private config;
    constructor();
    private loadConfig;
    private saveConfig;
    get(): WorkflowConfig;
    update(newConfig: Partial<WorkflowConfig>): void;
}
export declare const GlobalConfig: ConfigManager;
export {};
//# sourceMappingURL=config.d.ts.map