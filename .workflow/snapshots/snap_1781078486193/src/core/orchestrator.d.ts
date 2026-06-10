import { Plan } from '../types/workflow';
/**
 * The core orchestration engine that handles dynamic goal decomposition,
 * sub-agent dispatching, concurrency control, and continuous verification.
 */
export declare class Orchestrator {
    private decomposer;
    private pluginManager;
    private templateManager;
    /**
     * Initializes a new Orchestrator instance. Loads the default decomposer configuration
     * and prepares the internal LLM caller required for decomposing goals into atomic tasks.
     */
    constructor();
    private loadOrchestratorConfig;
    planWorkflow(goal: string): Promise<Plan>;
    /** 原有简单拆解逻辑（作为回退） */
    private planWorkflowSimple;
    /**
     * Executes the provided goal by dynamically generating a plan, provisioning tools,
     * launching SubAgents concurrently, and verifying the final output.
     *
     * @param {string} goal - The user's requested objective.
     * @param {{ resume?: boolean }} [options] - Optional configuration, such as resuming a halted workflow.
     * @returns {Promise<string>} The final verified summary string describing the outcome.
     */
    executeWorkflow(goal: string, options?: {
        resume?: boolean;
    }): Promise<string>;
}
//# sourceMappingURL=orchestrator.d.ts.map