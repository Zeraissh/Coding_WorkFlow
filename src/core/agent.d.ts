import { SubTask, TaskResult, AgentExecutionLog } from '../types/workflow';
import type { ToolRecord } from '../tools/registry/vector_store';
export declare class SubAgent {
    private agentId;
    private executionLog;
    constructor(agentId?: string);
    getAgentId(): string;
    getExecutionLog(): AgentExecutionLog;
    execute(task: SubTask, globalContext: string, toolRecords: ToolRecord[]): Promise<TaskResult>;
}
//# sourceMappingURL=agent.d.ts.map