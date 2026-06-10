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

/**
 * 生成缓存键 — 基于内容的稳定哈希
 * 使用简单的 djb2 哈希算法，避免引入 crypto 依赖
 */
function cacheKey(content: string): string {
  let hash = 5381;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0;
  }
  return 'ck_' + (hash >>> 0).toString(36);
}

// ============================================================================
// Anthropic ↔ OpenAI 消息格式转换
// ============================================================================

function mapAnthropicToolsToOpenAI(tools: Anthropic.Tool[] | undefined): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools) return undefined;
  return tools.map(t => ({
    type: 'function' as const,
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

// ============================================================================
// 报告 Token 用量（统一入口）
// ============================================================================

function reportTokenUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokens: number,
  agentId?: string,
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
      tokens: totalTokens,
      cachedTokens,
      calls: 1,
      cacheHitRate: inputTokens > 0 ? Math.round((cachedTokens / inputTokens) * 100) : 0,
      provider: provider || 'unknown',
    });
  }
}

// ============================================================================
// 主入口
// ============================================================================

export async function askLLM(
  system: string,
  messages: Anthropic.MessageParam[],
  tools?: Anthropic.Tool[],
  onToolCall?: (name: string, input: any) => Promise<string>,
  temperature: number = 0.7,
  taskId?: string,
  agentId?: string,
  maxTokens?: number
): Promise<Anthropic.Message> {
  const config = GlobalConfig.get();

  if (config.provider === 'openai' || config.provider === 'deepseek') {
    return await askOpenAI(system, messages, tools, onToolCall, temperature, taskId, agentId, config, maxTokens);
  }

  return await askAnthropic(system, messages, tools, onToolCall, temperature, taskId, agentId, config, maxTokens);
}

// ============================================================================
// OpenAI / DeepSeek 路径
// ============================================================================

async function askOpenAI(
  system: string,
  messages: Anthropic.MessageParam[],
  tools: Anthropic.Tool[] | undefined,
  onToolCall: ((name: string, input: any) => Promise<string>) | undefined,
  temperature: number,
  taskId: string | undefined,
  agentId: string | undefined,
  config: any,
  maxTokens?: number
): Promise<Anthropic.Message> {
  const openai = getOpenAIClient(config);

  // 构建消息列表 — system prompt 放在最前面以利用自动前缀缓存
  const openaiMessages = mapAnthropicMessageToOpenAI(messages);
  const options: any = {
    model: config.model,
    temperature,
    max_tokens: maxTokens || 4096,
    messages: [
      { role: 'system' as const, content: system },
      ...openaiMessages
    ]
  };

  const openAITools = mapAnthropicToolsToOpenAI(tools);
  if (openAITools && openAITools.length > 0) {
    options.tools = openAITools;
  }

  // DeepSeek 推理强度配置
  if (config.reasoningEffort && config.reasoningEffort !== 'none') {
    options.reasoning_effort = config.reasoningEffort;
    if (config.provider === 'deepseek') {
      // DeepSeek 支持的 thinking 参数
      options.extra_body = { thinking: { type: "enabled" } };
    }
  }

  let totalCachedTokens = 0;

  let response = await openai.chat.completions.create(options);
  // 记录首次调用的缓存 token
  const firstCached = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;
  totalCachedTokens += firstCached;

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
        toolResults.push({ type: 'tool_result', tool_use_id: c.id, content: `Error: ${err.message}`, is_error: true });
      }
    }

    if (toolResults.length > 0) {
      messages.push({ role: 'user', content: toolResults });
      // 重建消息列表 — system prompt 在每次重建中都保持首位
      options.messages = [
        { role: 'system' as const, content: system },
        ...mapAnthropicMessageToOpenAI(messages)
      ];
      response = await openai.chat.completions.create(options);
      // 累加后续调用的缓存 token
      const stepCached = (response.usage as any)?.prompt_tokens_details?.cached_tokens || 0;
      totalCachedTokens += stepCached;
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

  // Token 使用上报
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  reportTokenUsage(inputTokens, outputTokens, totalCachedTokens, agentId, config.provider);

  return {
    id: response.id,
    type: 'message',
    role: 'assistant',
    model: config.model,
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: inputTokens, output_tokens: outputTokens }
  } as Anthropic.Message;
}

// ============================================================================
// Anthropic 路径（带 Prompt Caching 支持）
// ============================================================================

/**
 * 为 tools 数组添加 cache_control 断点。
 * Anthropic 要求：最多 4 个 cache_control 断点，且最后一个 tool 必须带缓存标记。
 */
function annotateToolsForCache(tools: Anthropic.Tool[] | undefined): Anthropic.Tool[] | undefined {
  if (!tools || tools.length === 0) return tools;
  // 在最后一个 tool 上标记 cache_control，使工具定义可被缓存
  return tools.map((t, i) => {
    if (i === tools.length - 1) {
      return { ...t, cache_control: { type: 'ephemeral' as const } };
    }
    return t;
  });
}

/**
 * 为 message content blocks 添加 cache_control 断点。
 *
 * 缓存策略：
 * - 在最后一个 content block 上标记 cache_control
 * - 对于只有 text content 的消息，直接在 content 上标记
 * - 对于有多个 block 的消息，在最后一个 block 上标记
 */
function annotateMessageContentForCache(
  content: Anthropic.MessageParam['content']
): Anthropic.MessageParam['content'] {
  if (typeof content === 'string') {
    // string content → 转为带 cache_control 的 block 数组
    return [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }];
  }

  if (!Array.isArray(content) || content.length === 0) return content;

  // 在最后一个 content block 上添加 cache_control
  return content.map((block, i) => {
    if (i === content.length - 1 && 'type' in block) {
      return { ...block, cache_control: { type: 'ephemeral' as const } };
    }
    return block;
  });
}

/**
 * 构建带 cache_control 的 Anthropic system prompt。
 *
 * 系统提示词通常是最大且最稳定的内容块，缓存它可以显著提升命中率。
 * 格式：Anthropic 支持 system 为 string 或 {type, text, cache_control}[]
 */
function buildCachedSystemPrompt(system: string): Array<{ type: 'text'; text: string; cache_control: { type: 'ephemeral' } }> {
  return [
    {
      type: 'text',
      text: system,
      cache_control: { type: 'ephemeral' }
    }
  ];
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
  maxTokens?: number
): Promise<Anthropic.Message> {
  const anthropic = getAnthropicClient(config);

  // === Prompt Caching 优化 ===
  // 1. System prompt 加上 cache_control → 跨多轮调用复用
  const cachedSystem = buildCachedSystemPrompt(system);

  // 2. Tools 定义最后一个加上 cache_control → 跨 Agent 调用复用
  const cachedTools = annotateToolsForCache(tools);

  // 3. Messages — 最后一条消息的最后一个 block 加 cache_control
  //    使后续调用可以复用此前缀
  const cachedMessages = messages.map((msg, msgIndex) => {
    if (msgIndex === messages.length - 1) {
      return { ...msg, content: annotateMessageContentForCache(msg.content) };
    }
    return msg;
  });

  const options: Anthropic.MessageCreateParamsNonStreaming = {
    model: config.model,
    max_tokens: maxTokens || 4096,
    system: cachedSystem,
    messages: cachedMessages,
    temperature,
  };
  if (cachedTools && cachedTools.length > 0) {
    options.tools = cachedTools;
  }

  let totalCachedTokens = 0;
  let response = await anthropic.messages.create(options);

  // 记录首次调用的缓存读取量
  const firstCached = (response.usage as any)?.cache_read_input_tokens || 0;
  totalCachedTokens += firstCached;

  // === Multi-turn Tool Use Loop (with cache annotations) ===
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
      // 新消息：标记最后一个 tool_result 的 cache_control
      const annotatedToolResults = toolResults.map((tr, i) => {
        if (i === toolResults.length - 1) {
          return { ...tr, cache_control: { type: 'ephemeral' as const } };
        }
        return tr;
      });
      messages.push({ role: 'user', content: annotatedToolResults });

      // 重建请求 — 保持 system/tools 缓存标记
      options.messages = messages.map((msg, msgIndex) => {
        if (msgIndex === messages.length - 1) {
          return { ...msg, content: annotateMessageContentForCache(msg.content) };
        }
        // 中间消息的内容不做修改（已在上轮标记过）
        return msg;
      });
      response = await anthropic.messages.create(options);

      // 累加每轮的缓存读取量
      const stepCached = (response.usage as any)?.cache_read_input_tokens || 0;
      totalCachedTokens += stepCached;
    } else {
      break;
    }
  }

  // Token 使用上报
  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  reportTokenUsage(inputTokens, outputTokens, totalCachedTokens, agentId, 'anthropic');

  return response;
}
