import Anthropic from '@anthropic-ai/sdk';
import * as dotenv from 'dotenv';

dotenv.config();

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function askLLM(
  system: string,
  messages: Anthropic.MessageParam[],
  tools?: Anthropic.Tool[],
  temperature: number = 0.7
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

  const response = await anthropic.messages.create(options);
  return response;
}
