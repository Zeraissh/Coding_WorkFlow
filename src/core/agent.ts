import { askLLM } from '../llm/client';
import { SubTask, TaskResult } from '../types/workflow';
import { ToolRecord } from '../tools/registry/vector_store';
import { executeBuiltinTool } from '../tools/builtin';
import { MCPClientWrapper } from '../mcp/client';
import { Tool } from '@anthropic-ai/sdk/resources/messages.js';

export class SubAgent {
  async execute(task: SubTask, globalContext: string, toolRecords: ToolRecord[]): Promise<TaskResult> {
    const systemPrompt = `You are an expert sub-agent.
Your goal is to execute a specific sub-task as part of a larger workflow.
Global Context: ${globalContext}

Sub-Task ID: ${task.id}
Description: ${task.description}
Expected Output: ${task.expectedOutput}

You have been provided with specific tools for this task. Use them if needed to gather information or perform actions.
Please provide the best possible output for this sub-task.`;

    const activeMcpClients: MCPClientWrapper[] = [];
    const anthropicTools: Tool[] = [];
    const toolExecutors = new Map<string, (args: any) => Promise<string>>();

    try {
      for (const record of toolRecords) {
        if (record.source === 'builtin') {
          anthropicTools.push({
            name: record.name,
            description: record.description,
            input_schema: record.schema
          });
          toolExecutors.set(record.name, async (args) => executeBuiltinTool(record.name, args));
        } else if (record.source === 'mcp' && record.mcpCommand) {
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

      const response = await askLLM(
        systemPrompt, 
        [{ role: 'user', content: "Execute the sub-task." }],
        anthropicTools,
        async (name, input) => {
          const executor = toolExecutors.get(name);
          if (executor) {
            return await executor(input);
          }
          throw new Error(`Tool ${name} not found`);
        }
      );
      
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
      return {
        taskId: task.id,
        result: "",
        success: false,
        error: err.message || String(err)
      };
    } finally {
      for (const client of activeMcpClients) {
        try {
          await client.disconnect();
        } catch (e) {}
      }
    }
  }
}
