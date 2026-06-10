import { Plan } from '../types/workflow';
export declare class Orchestrator {
    planWorkflow(goal: string): Promise<Plan>;
    executeWorkflow(goal: string): Promise<string>;
}
//# sourceMappingURL=orchestrator.d.ts.map