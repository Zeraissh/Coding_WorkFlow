import { SubTask, TaskResult } from '../types/workflow';
import { ToolRecord } from '../tools/registry/vector_store';
export declare class SubAgent {
    execute(task: SubTask, globalContext: string, toolRecords: ToolRecord[]): Promise<TaskResult>;
}
//# sourceMappingURL=agent.d.ts.map