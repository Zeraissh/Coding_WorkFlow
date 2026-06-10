import Anthropic from '@anthropic-ai/sdk';
export declare function askLLM(system: string, messages: Anthropic.MessageParam[], tools?: Anthropic.Tool[], onToolCall?: (name: string, input: any) => Promise<string>, temperature?: number, taskId?: string, agentId?: string): Promise<Anthropic.Message>;
//# sourceMappingURL=client.d.ts.map