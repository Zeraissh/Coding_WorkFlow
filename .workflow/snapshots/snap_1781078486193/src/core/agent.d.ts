import { SubTask, TaskResult, AgentExecutionLog } from '../types/workflow';
import type { ToolRecord } from '../tools/registry/vector_store';
/**
 * Represents an autonomous sub-agent responsible for executing a single
 * discrete task within a larger workflow. Manages its own tool execution,
 * token budget, and lifecycle.
 */
export declare class SubAgent {
    private agentId;
    private executionLog;
    /**
     * Initializes a new SubAgent with a unique identifier.
     *
     * @param {string} [agentId] - An optional custom identifier. If not provided, a random one is generated.
     */
    constructor(agentId?: string);
    /**
     * Retrieves the unique identifier of this agent.
     *
     * @returns {string} The agent ID.
     */
    getAgentId(): string;
    /**
     * Retrieves a copy of the execution log containing detailed metrics and operations performed by this agent.
     *
     * @returns {AgentExecutionLog} A safe clone of the internal execution log.
     */
    getExecutionLog(): AgentExecutionLog;
    /**
     * Executes a given sub-task utilizing the LLM and the tools provided.
     * This involves injecting relevant project context, setting up MCP clients,
     * handling dynamic tool execution callbacks, and cleaning up resources upon completion.
     *
     * @param {SubTask} task - The specific sub-task definition.
     * @param {string} globalContext - High-level workflow context or goal.
     * @param {ToolRecord[]} toolRecords - A set of tools specifically retrieved/allocated for this task.
     * @returns {Promise<TaskResult>} The result of the task execution including success status and final output.
     */
    execute(task: SubTask, globalContext: string, toolRecords: ToolRecord[]): Promise<TaskResult>;
}
//# sourceMappingURL=agent.d.ts.map