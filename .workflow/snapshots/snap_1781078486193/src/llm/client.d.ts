import Anthropic from '@anthropic-ai/sdk';
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
export declare function askLLM(system: string, messages: Anthropic.MessageParam[], tools?: Anthropic.Tool[], onToolCall?: (name: string, input: any) => Promise<string>, temperature?: number, taskId?: string, agentId?: string): Promise<Anthropic.Message>;
//# sourceMappingURL=client.d.ts.map