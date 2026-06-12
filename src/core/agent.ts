import { askLLM } from '../llm/client';
import { SubTask, TaskResult, AgentExecutionLog, AgentFileOp } from '../types/workflow';
import type { ToolRecord } from '../tools/registry/vector_store';
import { executeBuiltinTool, builtinTools } from '../tools/builtin';
import { MCPClientWrapper } from '../mcp/client';
import { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import { fslock } from './fslock';
import { tokenBudget } from './tokenBudget';
import { getProjectMemory } from './memory';
import { MCPRegistry } from '../mcp/registry';
import { workflowEvents } from './events';

/**
 * Represents an autonomous sub-agent responsible for executing a single 
 * discrete task within a larger workflow. Manages its own tool execution, 
 * token budget, and lifecycle.
 */
export class SubAgent {
  private agentId: string;
  private executionLog: AgentExecutionLog;

  /**
   * Initializes a new SubAgent with a unique identifier.
   *
   * @param {string} [agentId] - An optional custom identifier. If not provided, a random one is generated.
   */
  constructor(agentId?: string) {
    this.agentId = agentId || `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.executionLog = {
      agentId: this.agentId,
      subtaskId: '',
      files: [],
      shellCommands: [],
      llmCalls: 0,
      tokensUsed: 0,
      errors: [],
    };
  }

  /**
   * Retrieves the unique identifier of this agent.
   *
   * @returns {string} The agent ID.
   */
  getAgentId(): string {
    return this.agentId;
  }

  /**
   * Retrieves a copy of the execution log containing detailed metrics and operations performed by this agent.
   *
   * @returns {AgentExecutionLog} A safe clone of the internal execution log.
   */
  getExecutionLog(): AgentExecutionLog {
    return { ...this.executionLog, files: [...this.executionLog.files] };
  }

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
  async execute(task: SubTask, globalContext: string, toolRecords: ToolRecord[]): Promise<TaskResult> {
    this.executionLog.subtaskId = task.id;

    const osInfo = process.platform === 'win32' ? 'Windows (use PowerShell)' : process.platform;
    const systemPrompt = `You are an expert sub-agent.
Your goal is to execute a specific sub-task as part of a larger workflow.
Global Context: ${globalContext}

OS Environment: ${osInfo}.
CRITICAL OS RULES:
- Use appropriate terminal commands for the OS.
- Do NOT output massive amounts of text (e.g. avoid 'tree /f' or 'ls -R' in root). Use the 'list_dir' tool instead.

Sub-Task ID: ${task.id}
Description: ${task.description}
Expected Output: ${task.expectedOutput}
${task.isolatedFiles ? `\nIsolated Files (you have exclusive write access): ${task.isolatedFiles.join(', ')}` : ''}
${task.sharedFiles ? `\nShared Files (read-only for you): ${task.sharedFiles.join(', ')}` : ''}

You have been provided with specific tools for this task. Use them if needed to gather information or perform actions.
CRITICAL INSTRUCTION (SELF-CORRECTION):
- You MUST verify your code by running tests, compiling, or executing it using the \`run_terminal_command\` tool.
- If you encounter errors, you MUST iteratively fix the code and re-test it.
- You are allowed a maximum of 3 failed attempts to fix errors before you must give up and return the best partial result.
Please provide the best possible output for this sub-task.`;

    const projectMemory = getProjectMemory();
    const finalSystemPrompt = projectMemory 
      ? systemPrompt + `\n\nProject Memory (Strictly follow these rules):\n${projectMemory}`
      : systemPrompt;

    const activeMcpClients: MCPClientWrapper[] = [];
    const anthropicTools: Tool[] = [];
    const toolExecutors = new Map<string, (args: any) => Promise<string>>();

    let toolCallCount = 0;
    const MAX_TOOL_CALLS = 25;

    try {
      // 1. Always inject built-in tools (read_file, write_file, run_terminal_command, etc.)
      for (const tool of builtinTools) {
        anthropicTools.push({
          name: tool.name,
          description: tool.description,
          input_schema: tool.input_schema as Tool.InputSchema
        });
        toolExecutors.set(tool.name, async (args) => {
          // 记录文件操作
          if (tool.name === 'write_file') {
            this.executionLog.files.push({
              agentId: this.agentId,
              subtaskId: task.id,
              operation: 'write',
              filePath: args.path,
              content: args.content,
              timestamp: Date.now(),
            });
          } else if (tool.name === 'read_file') {
            this.executionLog.files.push({
              agentId: this.agentId,
              subtaskId: task.id,
              operation: 'read',
              filePath: args.path,
              timestamp: Date.now(),
            });
          } else if (tool.name === 'run_terminal_command') {
            this.executionLog.shellCommands.push(args.command);
          }
          return await executeBuiltinTool(tool.name, args, this.agentId);
        });
      }

      // 2. Inject dynamically retrieved tools (e.g. MCP)
      for (const record of toolRecords) {
        if (record.source === 'mcp' && record.mcpCommand && record.mcpCommand[0]) {
          const client = new MCPClientWrapper(record.mcpCommand[0], record.mcpCommand.slice(1));
          await client.connect();
          activeMcpClients.push(client);

          const mcpTools = await client.getTools();
          for (const mTool of mcpTools) {
            anthropicTools.push(mTool);
            toolExecutors.set(mTool.name, async (args) => client.callTool(mTool.name, args));
          }
        }
      }

      // 3. Inject global MCP ecosystem tools
      const globalTools = MCPRegistry.getInstance().getGlobalTools();
      for (const mTool of globalTools) {
        if (!toolExecutors.has(mTool.name)) {
          anthropicTools.push(mTool);
          toolExecutors.set(mTool.name, async (args) => MCPRegistry.getInstance().callTool(mTool.name, args));
        }
      }

      // --- Token 预算检查 ---
      const budgetCheck = tokenBudget().checkBudget(this.agentId);
      if (!budgetCheck.canContinue) {
        const result: TaskResult = {
          taskId: task.id,
          result: budgetCheck.warning || 'Budget exhausted',
          success: false,
        };
        if (budgetCheck.warning) result.error = budgetCheck.warning;
        return result;
      }

      const response = await askLLM(
        finalSystemPrompt,
        [{ role: 'user', content: "Execute the sub-task." }],
        anthropicTools,
        async (name, input) => {
          toolCallCount++;
          if (toolCallCount > MAX_TOOL_CALLS) {
            return `System Error: Maximum tool call limit (${MAX_TOOL_CALLS}) reached. You must stop calling tools and provide your final response immediately.`;
          }
          
          if (task.id) workflowEvents.emit('log', { taskId: task.id, message: `[${this.agentId}] [Tool Call] ${name}` });

          const executor = toolExecutors.get(name);
          if (executor) {
            const result = await executor(input);
            if (task.id) {
              workflowEvents.emit('log', { taskId: task.id, message: `[${this.agentId}] [Tool Result] ${result.slice(0, 100)}...` });
              if (name === 'write_file' || name === 'replace_file_content' || name === 'multi_replace_file_content') {
                try {
                  const args = typeof input === 'string' ? JSON.parse(input) : input;
                  const filePath = args.TargetFile || args.path;
                  if (filePath) {
                    workflowEvents.emit('fileChanged', { taskId: task.id, file: filePath });
                  }
                } catch (e) {}
              }
            }
            return result;
          }
          throw new Error(`Tool ${name} not found`);
        },
        0.7,
        task.id,
        this.agentId
      );

      this.executionLog.llmCalls++;

      const contentText = response.content.find(block => block.type === 'text');
      if (!contentText || contentText.type !== 'text') {
        throw new Error("Failed to get text response from LLM");
      }

      this.executionLog.tokensUsed = tokenBudget().getUsage(this.agentId);

      return {
        taskId: task.id,
        result: contentText.text,
        success: true,
        agentId: this.agentId,
        executionLog: this.getExecutionLog()
      };
    } catch (err: any) {
      this.executionLog.errors.push(err.message || String(err));
      this.executionLog.tokensUsed = tokenBudget().getUsage(this.agentId);
      return {
        taskId: task.id,
        result: "",
        success: false,
        error: err.message || String(err),
        agentId: this.agentId,
        executionLog: this.getExecutionLog()
      };
    } finally {
      // 释放该 Agent 持有的所有文件锁
      fslock().releaseAll(this.agentId);

      // 断开 MCP
      for (const client of activeMcpClients) {
        try {
          await client.disconnect();
        } catch (e: any) {
          console.warn(`[agent:${this.agentId}] MCP disconnect failed: ${e.message}`);
        }
      }
    }
  }
}
