import { Plan } from '../types/workflow';
export declare class Orchestrator {
    private decomposer;
    constructor();
    private loadOrchestratorConfig;
    planWorkflow(goal: string): Promise<Plan>;
    /** 原有简单拆解逻辑（作为回退） */
    private planWorkflowSimple;
    executeWorkflow(goal: string, options?: {
        resume?: boolean;
    }): Promise<string>;
}
//# sourceMappingURL=orchestrator.d.ts.map