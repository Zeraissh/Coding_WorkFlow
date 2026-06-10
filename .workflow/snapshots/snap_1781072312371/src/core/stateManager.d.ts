import { Plan, TaskResult } from '../types/workflow';
export interface WorkflowState {
    goal: string;
    plan: Plan;
    results: TaskResult[];
    agentLogs: any[];
    status: 'planning' | 'executing' | 'verifying' | 'completed' | 'failed';
    currentBatchIndex: number;
}
export declare class StateManager {
    private stateFile;
    constructor(cwd?: string);
    saveState(state: WorkflowState): void;
    loadState(): WorkflowState | null;
    clearState(): void;
}
//# sourceMappingURL=stateManager.d.ts.map