import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock the single LLM entry point so the whole agent pipeline runs offline.
vi.mock('../src/llm/client', () => ({ askLLM: vi.fn() }));

import { askLLM } from '../src/llm/client';
import { SubAgent } from '../src/core/agent';
import { fslock } from '../src/core/fslock';
import { tokenBudget, TokenBudgetManager } from '../src/core/tokenBudget';
import { workflowEvents } from '../src/core/events';
import type { SubTask } from '../src/types/workflow';

const mockAskLLM = vi.mocked(askLLM);

/** Anthropic Message-shaped reply the agent expects (only the text block matters). */
function textReply(text: string): any {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} };
}

function makeTask(over: Partial<SubTask> = {}): SubTask {
  return {
    id: 'task-1',
    description: 'do a thing',
    expectedOutput: 'a thing done',
    estimatedComplexity: 3,
    dependencies: [],
    isolatedFiles: [],
    sharedFiles: [],
    ...over,
  } as SubTask;
}

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'));
  process.chdir(tmpDir);
  fslock().reset();
  TokenBudgetManager.resetInstance();
  mockAskLLM.mockReset();
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SubAgent.execute — control flow with mock LLM', () => {
  it('returns a successful TaskResult from a tool-less completion', async () => {
    mockAskLLM.mockResolvedValue(textReply('all done'));

    const agent = new SubAgent('agent-x');
    const result = await agent.execute(makeTask(), 'global goal', []);

    expect(result.success).toBe(true);
    expect(result.result).toBe('all done');
    expect(result.agentId).toBe('agent-x');
    expect(result.executionLog!.llmCalls).toBe(1);
    expect(result.executionLog!.files).toHaveLength(0);
    expect(mockAskLLM).toHaveBeenCalledTimes(1);
  });

  it('passes the assembled builtin tools and task context to the LLM', async () => {
    mockAskLLM.mockResolvedValue(textReply('ok'));
    await new SubAgent().execute(makeTask({ description: 'parse logs' }), 'ctx', []);

    const [system, messages, tools] = mockAskLLM.mock.calls[0] as any[];
    const toolNames = tools.map((t: any) => t.name);
    expect(toolNames).toContain('write_file');
    expect(toolNames).toContain('read_file');
    expect(toolNames).toContain('run_terminal_command');
    expect(system).toContain('parse logs'); // task description injected
    expect(messages[0].content).toContain('Execute the sub-task');
  });

  it('drives the tool loop: a write_file call lands on disk and is logged', async () => {
    mockAskLLM.mockImplementation(async (_sys, _msgs, _tools, onToolCall: any) => {
      const out = await onToolCall('write_file', { path: 'out.txt', content: 'hello world' });
      expect(out).toContain('Successfully wrote');
      return textReply('wrote the file');
    });

    const result = await new SubAgent().execute(makeTask(), 'goal', []);

    expect(result.success).toBe(true);
    expect(fs.readFileSync(path.join(tmpDir, 'out.txt'), 'utf-8')).toBe('hello world');
    const writes = result.executionLog!.files.filter(f => f.operation === 'write');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.filePath).toBe('out.txt');
  });

  it('maps an LLM failure to an unsuccessful result and records the error', async () => {
    mockAskLLM.mockRejectedValue(new Error('LLM exploded'));

    const result = await new SubAgent().execute(makeTask(), 'goal', []);

    expect(result.success).toBe(false);
    expect(result.error).toContain('LLM exploded');
    expect(result.executionLog!.errors.some(e => e.includes('LLM exploded'))).toBe(true);
  });

  it('short-circuits without calling the LLM when the global budget is exhausted', async () => {
    const budget = tokenBudget();
    budget.configure({ enabled: true, totalTokens: 50 });
    budget.allocateForTasks([makeTask() as any]);
    budget.reportUsage('someone-else', 100); // push global spend over the cap

    const result = await new SubAgent().execute(makeTask(), 'goal', []);

    expect(result.success).toBe(false);
    expect(mockAskLLM).not.toHaveBeenCalled();
  });

  it('releases all file locks after completion', async () => {
    mockAskLLM.mockImplementation(async (_s, _m, _t, onToolCall: any) => {
      await onToolCall('write_file', { path: 'a.txt', content: 'x' });
      return textReply('done');
    });

    const agent = new SubAgent('locker');
    await agent.execute(makeTask(), 'goal', []);
    expect(fslock().isLocked(path.join(tmpDir, 'a.txt'))).toBe(false);
  });
});

describe('SubAgent.execute — focus monitoring integration', () => {
  it('emits a focus intervention when the agent writes outside its declared scope', async () => {
    const events: any[] = [];
    const listener = (d: any) => events.push(d);
    workflowEvents.on('focusIntervention', listener);

    mockAskLLM.mockImplementation(async (_s, _m, _t, onToolCall: any) => {
      await onToolCall('write_file', { path: 'evil.ts', content: 'x' });
      return textReply('done');
    });

    try {
      await new SubAgent().execute(makeTask({ isolatedFiles: ['allowed.ts'] }), 'goal', []);
    } finally {
      workflowEvents.off('focusIntervention', listener);
    }

    expect(events.some(e => e.type === 'out_of_scope_write')).toBe(true);
  });
});
