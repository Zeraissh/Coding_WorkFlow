import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';
import { tokenBudget } from '../core/tokenBudget';

dotenv.config();

function mapAnthropicToolsToOpenAI(tools: Anthropic.Tool[] | undefined): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema as any
    }
  }));
}

function mapAnthropicMessageToOpenAI(messages: Anthropic.MessageParam[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];

  for (const m of messages) {
    if (m.role === 'user') {
      if (typeof m.content === 'string') {
        openaiMessages.push({ role: 'user', content: m.content });
      } else {
        const parts = m.content;
        for (const part of parts) {
          if (part.type === 'tool_result') {
            openaiMessages.push({
              role: 'tool',
              tool_call_id: part.tool_use_id,
              content: part.content as string
            });
          } else if (part.type === 'text') {
            openaiMessages.push({ role: 'user', content: part.text });
          }
        }
      }
    } else if (m.role === 'assistant') {
      if (typeof m.content === 'string') {
        openaiMessages.push({ role: 'assistant', content: m.content });
      } else {
        let textContent = '';
        const toolCalls: any[] = [];
        for (const part of m.content) {
          if (part.type === 'text') {
            textContent += part.text;
          } else if (part.type === 'tool_use') {
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: {
                name: part.name,
                arguments: JSON.stringify(part.input)
              }
            });
          }
        }
        
        const assistantMsg: any = { role: 'assistant' };
        if (textContent) assistantMsg.content = textContent;
        if (toolCalls.length > 0) assistantMsg.tool_calls = toolCalls;
        
        openaiMessages.push(assistantMsg);
      }
    }
  }
  return openaiMessages;
}

export async function askLLM(
  system: string,
  messages: Anthropic.MessageParam[],
  tools?: Anthropic.Tool[],
  onToolCall?: (name: string, input: any) => Promise<string>,
  temperature: number = 0.7,
  taskId?: string,
  agentId?: string
): Promise<Anthropic.Message> {
  const config = GlobalConfig.get();

  if (config.provider === 'openai' || config.provider === 'deepseek') {
    return await askOpenAI(system, messages, tools, onToolCall, temperature, taskId, agentId, config);
  }

  return await askAnthropic(system, messages, tools, onToolCall, temperature, taskId, agentId, config);
}

async function askOpenAI(
  system: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[] | undefined,
  onToolCall: ((name: string, input: any) => Promise<string>) | undefined,
  temperature: number,
  taskId: string | undefined,
  agentId: string | undefined,
  config: any
): Promise<Anthropic.Message> {
  const openai = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.provider === 'deepseek' ? 'https://api.deepseek.com' : undefined
  });

  const options: any = {
    model: config.model,
    temperature,
    messages: [
      { role: 'system', content: system },
      ...mapAnthropicMessageToOpenAI(messages)
    ]
  };

  const openAITools = mapAnthropicToolsToOpenAI(tools);
  if (openAITools && openAITools.length > 0) {
    options.tools = openAITools;
  }

  if (config.reasoningEffort && config.reasoningEffort !== 'none') {
    options.reasoning_effort = config.reasoningEffort;
    if (config.provider === 'deepseek') {
      options.extra_body = { thinking: { type: "enabled" } };
    }
  }

  let response = await openai.chat.completions.create(options);

  while (response.choices[0]!.message.tool_calls && onToolCall) {
    const msg = response.choices[0]!.message;

    const anthropicContent: any[] = [];
    if (msg.content) {
      anthropicContent.push({ type: 'text', text: msg.content });
    }
    for (const call of (msg.tool_calls || [])) {
      const c = call as any;
      anthropicContent.push({
        type: 'tool_use',
        id: c.id,
        name: c.function.name,
        input: JSON.parse(c.function.arguments)
      });
    }
    messages.push({ role: 'assistant', content: anthropicContent });

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const call of (msg.tool_calls || [])) {
      const c = call as any;
      try {
        const inputArgs = JSON.parse(c.function.arguments);
        if (taskId) workflowEvents.emit('log', { taskId, message: `[Tool Call] ${c.function.name}` });

        if (config.requireApproval && c.function.name === 'run_terminal_command') {
          await new Promise<void>((resolve, reject) => {
            workflowEvents.emit('approvalRequested', {
              taskId: taskId || 'unknown',
              toolName: c.function.name,
              arguments: inputArgs,
              resolve,
              reject
            });
          });
        }

        const result = await onToolCall(c.function.name, inputArgs);
        if (taskId) workflowEvents.emit('log', { taskId, message: `[Tool Result] ${result.slice(0, 100)}...` });

        toolResults.push({ type: 'tool_result', tool_use_id: c.id, content: result });
      } catch (err: any) {
        if (taskId) workflowEvents.emit('log', { taskId, message: `[Tool Error] ${err.message}` });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: `Error: ${err.message}`, is_error: true });
      }
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
      options.messages = [
        { role: 'system', content: system },
        ...mapAnthropicMessageToOpenAI(messages)
      ];
      response = await openai.chat.completions.create(options);
    } else {
      break;
    }
  }

  const finalMsg = response.choices[0]!.message;
  let text = finalMsg.content || '';

  const reasoning = (finalMsg as any).reasoning_content;
  if (reasoning) {
    text = `<thinking>\n${reasoning}\n</thinking>\n\n` + text;
  }

  // --- Token 使用上报 ---
  const totalTokens = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0);
  const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;
  if (totalTokens > 0) {
    if (agentId) tokenBudget().reportUsage(agentId, totalTokens);
    workflowEvents.emit('llmUsageReport', { tokens: totalTokens, cachedTokens, calls: 1 });
  }

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: config.model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: response.usage?.prompt_tokens || 0, output_tokens: response.usage?.completion_tokens || 0 }
  } as Anthropic.Message;
}

async function askAnthropic(
  system: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[] | undefined,
  onToolCall: ((name: string, input: any) => Promise<string>) | undefined,
  temperature: number,
  taskId: string | undefined,
  agentId: string | undefined,
  config: any
): Promise<Anthropic.Message> {
  const anthropic = new Anthropic({ apiKey: config.apiKey });
  const options: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.model,
    max_tokens: 4096,
    system,
    messages,
    temperature,
  };
  if (tools && tools.length > 0) options.tools = tools;

  let response = await anthropic.messages.create(options);

  while (response.stop_reason === 'tool_use' && onToolCall) {
    messages.push({ role: 'assistant', content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        try {
          if (taskId) workflowEvents.emit('log', { taskId, message: `[Tool Call] ${block.name}` });

          if (config.requireApproval && block.name === 'run_terminal_command') {
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
          if (taskId) workflowEvents.emit('log', { taskId, message: `[Tool Result] ${result.slice(0, 100)}...` });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        } catch (err: any) {
          if (taskId) workflowEvents.emit('log', { taskId, message: `[Tool Error] ${err.message}` });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
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

  // --- Token 使用上报 ---
  const totalTokens = (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0);
  const cachedTokens = (response.usage as any)?.cache_read_input_tokens || 0;
  if (totalTokens > 0) {
    if (agentId) tokenBudget().reportUsage(agentId, totalTokens);
    workflowEvents.emit('llmUsageReport', { tokens: totalTokens, cachedTokens, calls: 1 });
  }

  return response;
}
