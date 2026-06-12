import { describe, it, expect } from 'vitest';
import { compactMessagesInPlace } from '../src/llm/client';
import type Anthropic from '@anthropic-ai/sdk';

function toolResultMsg(content: string, id = 'tu_1'): Anthropic.MessageParam {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content }] };
}

function assistantToolUse(id = 'tu_1'): Anthropic.MessageParam {
  return { role: 'assistant', content: [{ type: 'tool_use', id, name: 'read_file', input: { path: 'a.ts' } }] };
}

const config = { maxChars: 2000, keepRecent: 2, digestChars: 100 };

describe('compactMessagesInPlace', () => {
  it('does nothing below the watermark', () => {
    const messages = [toolResultMsg('short result')];
    expect(compactMessagesInPlace(messages, config)).toBe(false);
    expect((messages[0]!.content as any)[0].content).toBe('short result');
  });

  it('folds old long tool results but keeps recent messages intact', () => {
    const big = 'x'.repeat(1500);
    const messages: Anthropic.MessageParam[] = [
      assistantToolUse('tu_1'),
      toolResultMsg(big, 'tu_1'),
      assistantToolUse('tu_2'),
      toolResultMsg(big, 'tu_2'), // 最近 2 条之一 → 保留
    ];

    expect(compactMessagesInPlace(messages, config)).toBe(true);

    const oldResult = (messages[1]!.content as any)[0].content as string;
    expect(oldResult.length).toBeLessThan(200);
    expect(oldResult).toContain('compacted');
    expect(oldResult).toContain('1500 chars total');

    const recentResult = (messages[3]!.content as any)[0].content as string;
    expect(recentResult).toBe(big);
  });

  it('leaves assistant tool_use blocks untouched (protocol pairing)', () => {
    const big = 'y'.repeat(3000);
    const messages: Anthropic.MessageParam[] = [
      assistantToolUse('tu_1'),
      toolResultMsg(big, 'tu_1'),
      { role: 'user', content: 'continue' },
      { role: 'user', content: 'continue 2' },
    ];
    compactMessagesInPlace(messages, config);
    expect((messages[0]!.content as any)[0]).toMatchObject({ type: 'tool_use', id: 'tu_1' });
  });

  it('does not double-compact already folded results', () => {
    const big = 'z'.repeat(3000);
    const messages: Anthropic.MessageParam[] = [
      toolResultMsg(big, 'tu_1'),
      { role: 'user', content: 'a'.repeat(2500) }, // 维持超水位
      { role: 'user', content: 'pad1' },
      { role: 'user', content: 'pad2' },
    ];
    compactMessagesInPlace(messages, config);
    const once = (messages[0]!.content as any)[0].content;
    compactMessagesInPlace(messages, config);
    expect((messages[0]!.content as any)[0].content).toBe(once);
  });

  it('ignores short tool results and plain string messages', () => {
    const messages: Anthropic.MessageParam[] = [
      toolResultMsg('tiny', 'tu_1'),
      { role: 'user', content: 'b'.repeat(2500) },
      { role: 'user', content: 'pad1' },
      { role: 'user', content: 'pad2' },
    ];
    compactMessagesInPlace(messages, config);
    expect((messages[0]!.content as any)[0].content).toBe('tiny');
    expect(messages[1]!.content).toBe('b'.repeat(2500)); // 字符串消息不折叠
  });
});
