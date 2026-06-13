import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../src/llm/client', () => ({ askLLM: vi.fn() }));

import { askLLM } from '../src/llm/client';
import { Verifier } from '../src/core/verifier';
import { workflowEvents } from '../src/core/events';

const mockAskLLM = vi.mocked(askLLM);

function textReply(text: string): any {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} };
}

const plan: any = { goal: 'build a todo app', tasks: [], parallelBatches: [] };
const results: any = [
  { taskId: 't1', result: 'created app.ts', success: true },
  { taskId: 't2', result: 'added tests', success: true },
];

beforeEach(() => {
  mockAskLLM.mockReset();
});

describe('Verifier.verifyAndSynthesize — synthesis path with mock LLM', () => {
  it('returns the synthesized text when there are no agent logs (auto-check skipped)', async () => {
    mockAskLLM.mockResolvedValue(textReply('the final synthesized result'));

    const out = await new Verifier().verifyAndSynthesize(plan, results, []);

    expect(out).toBe('the final synthesized result');
    expect(mockAskLLM).toHaveBeenCalledTimes(1); // only the synthesis call, no semantic review
  });

  it('feeds the goal and sub-task results into the synthesis prompt', async () => {
    mockAskLLM.mockResolvedValue(textReply('done'));
    await new Verifier().verifyAndSynthesize(plan, results, []);

    const systemPrompt = String(mockAskLLM.mock.calls[0]![0]);
    expect(systemPrompt).toContain('build a todo app');
    expect(systemPrompt).toContain('created app.ts');
  });

  it('emits a structured verificationReport event (nulls when no auto-check ran)', async () => {
    mockAskLLM.mockResolvedValue(textReply('done'));
    const events: any[] = [];
    const listener = (d: any) => events.push(d);
    workflowEvents.on('verificationReport', listener);

    try {
      await new Verifier().verifyAndSynthesize(plan, results, []);
    } finally {
      workflowEvents.off('verificationReport', listener);
    }

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      passed: null,
      lintErrors: 0,
      typeErrors: 0,
      fileConflicts: 0,
      semanticIssues: 0,
    });
  });

  it('still synthesizes when some sub-tasks failed', async () => {
    mockAskLLM.mockResolvedValue(textReply('synthesis noting the partial failure'));
    const mixed: any = [
      { taskId: 't1', result: 'ok', success: true },
      { taskId: 't2', result: '', success: false, error: 'compile error' },
    ];

    const out = await new Verifier().verifyAndSynthesize(plan, mixed, []);
    expect(out).toContain('synthesis noting the partial failure');
  });
});
