import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';
import { tokenBudget } from '../core/tokenBudget';

dotenv.config();

// ============================================================================
// Singleton LLM Clients — 复用客户端实例，避免每次调用都新建连接
// ============================================================================

let _openaiClient: OpenAI | null = null;
let _openaiConfigKey: string = '';

function getOpenAIClient(config: any): OpenAI {
  const key = `${config.apiKey}:${config.provider}`;
  if (!_openaiClient || _openaiConfigKey !== key) {
    _openaiClient = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.provider === 'deepseek' ? 'https://api.deepseek.com' : undefined,
      maxRetries: 2,
      timeout: 120000, // 120s timeout — DeepSeek reasoning can be slow
    });
    _openaiConfigKey = key;
  }
  return _openaiClient;
}

let _anthropicClient: Anthropic | null = null;
let _anthropicConfigKey: string = '';

function getAnthropicClient(config: any): Anthropic {
  const key = config.apiKey;
  if (!_anthropicClient || _anthropicConfigKey !== key) {
    _anthropicClient = new Anthropic({ apiKey: config.apiKey });
    _anthropicConfigKey = key;
  }
  return _anthropicClient;
}

// ============================================================================
// Prompt Cache — 缓存命中率统计与缓存键管理
// ============================================================================

/**
 * 缓存统计信息，追踪每个缓存键的命中情况
 */
interface CacheStats {
  systemPromptKey: string;
  toolDefKey: string;
  hitCount: number;
  missCount: number;
  totalCachedTokens: number;
  totalInputTokens: number;
}

let _cacheStats: CacheStats = {
  systemPromptKey: '',
  toolDefKey: '',
  hitCount: 0,
  missCount: 0,
  totalCachedTokens: 0,
  totalInputTokens: 0,
};

/** 获取当前缓存统计 */
export function getCacheStats(): Readonly<CacheStats> {
  return { ..._cacheStats };
}

/** 重置缓存统计 */
export function resetCacheStats(): void {
  _cacheStats = {
    systemPromptKey: '',
    toolDefKey: '',
    hitCount: 0,
    missCount: 0,
    totalCachedTokens: 0,
    totalInputTokens: 0,
  };
}

// ============================================================================
// 报告 Token 用量（统一入口）
// ============================================================================

function reportTokenUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  agentId?: string,
  taskId?: string,
  provider?: string
): void {
  const totalTokens = inputTokens + outputTokens;

  // 更新全局缓存统计
  _cacheStats.totalCachedTokens += cachedTokens;
  _cacheStats.totalInputTokens += inputTokens;
  if (cachedTokens > 0) {
    _cacheStats.hitCount++;
  } else if (inputTokens > 0) {
    _cacheStats.missCount++;
  }

  if (totalTokens > 0) {
    if (agentId) tokenBudget().reportUsage(agentId, totalTokens);
    workflowEvents.emit('llmUsageReport', {
      taskId,
      agentId,
      tokens: totalTokens,
      cachedTokens,
      calls: 1,
      cacheHitRate: inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0,
      provider: provider || 'unknown',
    });
  }
}

// ============================================================================
// Anthropic ↔ OpenAI 消息格式转换
// ============================================================================

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

async function withRetry<T>(
  operation: () => Promise<T>,
  agentId?: string,
  taskId?: string,
  maxRetries = 3,
  signal?: AbortSignal
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      const status = error?.status || error?.response?.status;

      // E-Stop / 主动中止：立即抛出，不重试
      if (signal?.aborted || error?.name === 'AbortError' || error?.name === 'APIUserAbortError') {
        throw new Error(`LLM call aborted: ${signal?.reason?.message || error.message}`);
      }

      // Fatal errors: don't retry
      if (status === 401 || status === 403 || status === 404) {
        const msg = `Fatal LLM API Error (${status}): ${error.message}. Please check your API key and model configuration.`;
        if (taskId) workflowEvents.emit('log', { taskId, message: msg });
        throw new Error(msg);
      }
      
      if (attempt > maxRetries) {
        throw error;
      }
      
      const delay = Math.pow(2, attempt - 1) * 2000;
      const prefix = agentId ? `[${agentId}] ` : '';
      const msg = `${prefix}LLM API Error (${status || error.message}). Retrying in ${delay}ms (Attempt ${attempt}/${maxRetries})...`;
      if (taskId) workflowEvents.emit('log', { taskId, message: msg });
      else console.warn(msg);
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Generic abstraction over multiple LLM providers (Anthropic, OpenAI, DeepSeek).
 * Handles structured inputs, manages prompt caching, maps tools to provider-specific formats,
 * invokes tools recursively, and handles retry mechanisms.
 *
 * @param {string} system - The system prompt defining the agent's persona and critical context.
 * @param {Anthropic.MessageParam[]} messages - The conversation history or current prompt.
 * @param {Anthropic.Tool[]} [tools] - Optional tool definitions mapped to the model.
 * @param {(name: string, input: any) => Promise<string>} [onToolCall] - Callback executed when the LLM requests a tool.
 * @param {number} [temperature=0.7] - The model's sampling temperature.
 * @param {string} [taskId] - The current Task ID for logging context.
 * @param {string} [agentId] - The executing SubAgent ID for budget tracking.
 * @returns {Promise<Anthropic.Message>} The final response from the LLM after all tool calls complete.
 */
export interface AskLLMOptions {
  /** 流式文本增量回调（同时会触发 assistantDelta 事件推送到 Dashboard） */
  onText?: ((delta: string) => void) | undefined;
  /** E-Stop 中止信号 */
  signal?: AbortSignal | undefined;
}

export async function askLLM(
  system: string,
  messages: Anthropic.MessageParam[],
  tools?: Anthropic.Tool[],
  onToolCall?: (name: string, input: any) => Promise<string>,
  temperature: number = 0.7,
  taskId?: string,
  agentId?: string,
  opts: AskLLMOptions = {}
): Promise<Anthropic.Message> {
  const config = GlobalConfig.get();

  if (config.provider === 'openai' || config.provider === 'deepseek') {
    return await askOpenAI(system, messages, tools, onToolCall, temperature, taskId, agentId, config, opts);
  }

  return await askAnthropic(system, messages, tools, onToolCall, temperature, taskId, agentId, config, opts);
}

/** 流式增量统一出口：本地回调 + Dashboard 事件 */
function emitTextDelta(delta: string, opts: AskLLMOptions, taskId?: string, agentId?: string): void {
  if (!delta) return;
  opts.onText?.(delta);
  if (taskId || agentId) {
    workflowEvents.emit('assistantDelta', { taskId, agentId, text: delta });
  }
}

/** 消费 OpenAI 流式响应，把 chunk 累积回一个完整的 ChatCompletion 形状 */
async function consumeOpenAIStream(
  stream: AsyncIterable<any>,
  opts: AskLLMOptions,
  taskId?: string,
  agentId?: string
): Promise<any> {
  let id = '';
  let content = '';
  let reasoning = '';
  const toolCalls: any[] = [];
  let usage: any = undefined;
  let finishReason: string | null = null;

  for await (const chunk of stream) {
    if (chunk.id) id = chunk.id;
    if (chunk.usage) usage = chunk.usage;
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (choice.finish_reason) finishReason = choice.finish_reason;
    const delta = choice.delta;
    if (!delta) continue;
    if (delta.content) {
      content += delta.content;
      emitTextDelta(delta.content, opts, taskId, agentId);
    }
    if (delta.reasoning_content) {
      reasoning += delta.reasoning_content;
    }
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      if (!toolCalls[idx]) {
        toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } };
      }
      if (tc.id) toolCalls[idx].id = tc.id;
      if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
      if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
    }
  }

  const message: any = { role: 'assistant', content: content || null };
  if (reasoning) message.reasoning_content = reasoning;
  if (toolCalls.length > 0) message.tool_calls = toolCalls.filter(Boolean);

  return {
    id,
    usage,
    choices: [{ message, finish_reason: finishReason }],
  };
}

async function askOpenAI(
  system: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[] | undefined,
  onToolCall: ((name: string, input: any) => Promise<string>) | undefined,
  temperature: number,
  taskId: string | undefined,
  agentId: string | undefined,
  config: any,
  opts: AskLLMOptions = {}
): Promise<Anthropic.Message> {
  const openai = getOpenAIClient(config);

  const options: any = {
    model: config.model,
    temperature,
    stream: true,
    stream_options: { include_usage: true },
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

  const requestOptions: any = {};
  if (opts.signal) requestOptions.signal = opts.signal;

  const createStreamed = async () => {
    const stream = await openai.chat.completions.create(options, requestOptions);
    return consumeOpenAIStream(stream as unknown as AsyncIterable<any>, opts, taskId, agentId);
  };

  let response = await withRetry(createStreamed, agentId, taskId, 3, opts.signal);

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
        const logPrefix = agentId ? `[${agentId}] ` : '';
        if (taskId) workflowEvents.emit('log', { taskId, message: `${logPrefix}[Tool Call] ${c.function.name}` });

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
        const resultPrefix = agentId ? `[${agentId}] ` : '';
        if (taskId) workflowEvents.emit('log', { taskId, message: `${resultPrefix}[Tool Result] ${result.slice(0, 100)}...` });

        toolResults.push({ type: 'tool_result', tool_use_id: c.id, content: result });
      } catch (err: any) {
        const errPrefix = agentId ? `[${agentId}] ` : '';
        if (taskId) workflowEvents.emit('log', { taskId, message: `${errPrefix}[Tool Error] ${err.message}` });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: `Error: ${err.message}`, is_error: true });
      }
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
      options.messages = [
        { role: 'system', content: system },
        ...mapAnthropicMessageToOpenAI(messages)
      ];
      response = await withRetry(createStreamed, agentId, taskId, 3, opts.signal);
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
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const cachedTokens = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;
  reportTokenUsage(inputTokens, outputTokens, cachedTokens, agentId, taskId, config.provider);

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
  config: any,
  opts: AskLLMOptions = {}
): Promise<Anthropic.Message> {
  const anthropic = getAnthropicClient(config);
  const options: any = {
    model: config.model,
    max_tokens: 4096,
    system: [
      {
        type: "text",
        text: system,
        cache_control: { type: "ephemeral" }
      }
    ],
    messages,
    temperature,
  };
  if (tools && tools.length > 0) options.tools = tools;

  const requestOptions: any = {};
  if (opts.signal) requestOptions.signal = opts.signal;

  // 流式调用：SDK 的 stream helper 提供文本增量事件，finalMessage() 仍返回完整 Message
  const createStreamed = async (): Promise<Anthropic.Message> => {
    const stream = anthropic.messages.stream(options, requestOptions);
    stream.on('text', (delta: string) => emitTextDelta(delta, opts, taskId, agentId));
    return await stream.finalMessage();
  };

  let response = await withRetry(createStreamed, agentId, taskId, 3, opts.signal);

  while (response.stop_reason === 'tool_use' && onToolCall) {
    messages.push({ role: 'assistant', content: response.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    
    for (const block of response.content) {
      if (block.type === 'tool_use') {
        try {
          const callPrefix = agentId ? `[${agentId}] ` : '';
          if (taskId) workflowEvents.emit('log', { taskId, message: `${callPrefix}[Tool Call] ${block.name}` });

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
          const resultPrefix2 = agentId ? `[${agentId}] ` : '';
          if (taskId) workflowEvents.emit('log', { taskId, message: `${resultPrefix2}[Tool Result] ${result.slice(0, 100)}...` });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result });
        } catch (err: any) {
          const errPrefix2 = agentId ? `[${agentId}] ` : '';
          if (taskId) workflowEvents.emit('log', { taskId, message: `${errPrefix2}[Tool Error] ${err.message}` });
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: `Error: ${err.message}`, is_error: true });
        }
      }
    }
    
    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
      options.messages = messages;
      response = await withRetry(createStreamed, agentId, taskId, 3, opts.signal);
    } else {
      break;
    }
  }

  // --- Token 使用上报 ---
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  const cachedTokens = (response.usage as any)?.cache_read_input_tokens || 0;
  reportTokenUsage(inputTokens, outputTokens, cachedTokens, agentId, taskId, config.provider);

  return response;
}
