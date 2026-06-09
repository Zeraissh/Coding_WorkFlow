import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function askLLM(
  system: string,
  messages: Anthropic.MessageParam[],
  tools?: Anthropic.Tool[],
  onToolCall?: (name: string, input: any) => Promise<string>,
  temperature: number = 0.7,
  taskId?: string
): Promise<Anthropic.Message> {
  const options: Anthropic.MessageCreateParamsNonStreaming = {
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    system,
    messages,
    temperature,
  };

  if (tools && tools.length > 0) {
    options.tools = tools;
  }

  let response = await anthropic.messages.create(options);

  while (response.stop_reason === 'tool_use' && onToolCall) {
    messages.push({ role: 'assistant', content: response.content });
    
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        try {
          if (taskId) {
            workflowEvents.emit('log', { taskId, message: `[Tool Call] ${block.name} | Input: ${JSON.stringify(block.input)}` });
          }

          // HITL Interceptor
          if (GlobalConfig.requireApproval && block.name === 'run_terminal_command') {
            await new Promise<void>((resolve, reject) => {
              workflowEvents.emit('approvalRequested', {
                taskId: taskId || 'unknown',
                toolName: block.name,
                arguments: block.input,
                resolve,
                reject
              });
            });
          }

          const result = await onToolCall(block.name, block.input);
          
          if (taskId) {
            workflowEvents.emit('log', { taskId, message: `[Tool Result] ${result.slice(0, 200)}...` });
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result
          });
        } catch (err: any) {
          if (taskId) {
            workflowEvents.emit('log', { taskId, message: `[Tool Error] ${err.message}` });
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: `Error executing tool: ${err.message}`,
            is_error: true
          });
        }
      }
    }
    
    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
      options.messages = messages;
      response = await anthropic.messages.create(options);
    } else {
      break;
    }
  }

  return response;
}
