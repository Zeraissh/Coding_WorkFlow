import { askLLM } from '../llm/client';
import { SubTask, TaskResult, AgentExecutionLog, AgentFileOp } from '../types/workflow';
import type { ToolRecord } from '../tools/registry/vector_store';
import { executeBuiltinTool, builtinTools } from '../tools/builtin';
import { MCPClientWrapper } from '../mcp/client';
import { Tool } from '@anthropic-ai/sdk/resources/messages.js';
import { fslock } from './fslock';
import { tokenBudget } from './tokenBudget';
import { getProjectMemory } from './memory';

export class SubAgent {
  private agentId: string;
  private executionLog: AgentExecutionLog;

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

  getAgentId(): string {
    return this.agentId;
  }

  getExecutionLog(): AgentExecutionLog {
    return { ...this.executionLog, files: [...this.executionLog.files] };
  }

  async execute(task: SubTask, globalContext: string, toolRecords: ToolRecord[]): Promise<TaskResult> {
    this.executionLog.subtaskId = task.id;

    const systemPrompt = `You are an expert sub-agent.
Your goal is to execute a specific sub-task as part of a larger workflow.
Global Context: ${globalContext}

Sub-Task ID: ${task.id}
Description: ${task.description}
Expected Output: ${task.expectedOutput}
${task.isolatedFiles ? `\nIsolated Files (you have exclusive write access): ${task.isolatedFiles.join(', ')}` : ''}
${task.sharedFiles ? `\nShared Files (read-only for you): ${task.sharedFiles.join(', ')}` : ''}

You have been provided with specific tools for this task. Use them if needed to gather information or perform actions.
Please provide the best possible output for this sub-task.`;

    const projectMemory = getProjectMemory();
    const finalSystemPrompt = projectMemory 
      ? systemPrompt + `\n\nProject Memory (Strictly follow these rules):\n${projectMemory}`
      : systemPrompt;

    const activeMcpClients: MCPClientWrapper[] = [];
    const anthropicTools: Tool[] = [];
    const toolExecutors = new Map<string, (args: any) => Promise<string>>();

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
          const executor = toolExecutors.get(name);
          if (executor) {
            return await executor(input);
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

      return {
        taskId: task.id,
        result: contentText.text,
        success: true
      };
    } catch (err: any) {
      this.executionLog.errors.push(err.message || String(err));
      return {
        taskId: task.id,
        result: "",
        success: false,
        error: err.message || String(err)
      };
    } finally {
      // 释放该 Agent 持有的所有文件锁
      fslock().releaseAll(this.agentId);

      // 断开 MCP
      for (const client of activeMcpClients) {
        try {
          await client.disconnect();
        } catch (e) {}
      }
    }
  }
}
