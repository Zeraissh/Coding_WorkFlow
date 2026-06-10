import { Plan, TaskResult, AgentExecutionLog } from '../types/workflow';
export declare class Verifier {
    private autoChecker;
    private semanticReviewer;
    constructor();
    verifyAndSynthesize(plan: Plan, results: TaskResult[], agentLogs?: AgentExecutionLog[]): Promise<string>;
}
//# sourceMappingURL=verifier.d.ts.map