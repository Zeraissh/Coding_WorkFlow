import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Offline: mock the LLM, and stub the embedding indexer (avoids transformers/network).
vi.mock('../src/llm/client', () => ({ askLLM: vi.fn() }));
vi.mock('../src/core/indexer', () => ({
  ProjectIndexer: class {
    async scanAndIndex() {}
    async search() {
      return [];
    }
  },
}));

import { askLLM } from '../src/llm/client';
import { Orchestrator } from '../src/core/orchestrator';
import { fslock } from '../src/core/fslock';
import { TokenBudgetManager } from '../src/core/tokenBudget';

const mockAskLLM = vi.mocked(askLLM);

function textReply(text: string): any {
  return { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: {} };
}
function jsonBlock(obj: unknown): string {
  return '```json\n' + JSON.stringify(obj) + '\n```';
}

const SIMPLE_GAP = { complexityEstimate: 2, ambiguityScore: 0.1, missingDimensions: [], multiLayer: false };
const EMPTY_SELFCHECK = { missingDependencies: [], fileConflicts: [], overlyCoarse: [], overlyFine: [], warnings: [] };

/** Route each LLM call by a marker unique to its prompt. */
function installRouter(subtasks: unknown) {
  mockAskLLM.mockImplementation(async (system: any) => {
    const s = String(system);
    if (/ambiguityScore/.test(s)) return textReply(jsonBlock(SIMPLE_GAP)); // gap assessment → simple → skip clarify
    if (/overlyCoarse/.test(s)) return textReply(jsonBlock(EMPTY_SELFCHECK)); // decomposer self-check
    return textReply(typeof subtasks === 'string' ? subtasks : jsonBlock(subtasks)); // decomposition
  });
}

let tmpDir: string;
let origCwd: string;

beforeEach(() => {
  origCwd = process.cwd();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-'));
  process.chdir(tmpDir);
  fslock().reset();
  TokenBudgetManager.resetInstance();
  mockAskLLM.mockReset();
});

afterEach(() => {
  process.chdir(origCwd);
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('Orchestrator.planWorkflow — with mock LLM', () => {
  it('decomposes a simple goal into a dependency-ordered plan', async () => {
    installRouter([
      { id: 't1', description: 'first step', estimatedComplexity: 3 },
      { id: 't2', description: 'second step', estimatedComplexity: 4, dependencies: ['t1'] },
    ]);

    const plan = await new Orchestrator().planWorkflow('write a small script');

    expect(plan.goal).toBe('write a small script');
    expect(plan.tasks.map(t => t.id)).toEqual(['t1', 't2']);
    // t2 depends on t1 → two sequential batches
    expect(plan.parallelBatches!.map(b => b.map(t => t.id))).toEqual([['t1'], ['t2']]);
  });

  it('runs independent subtasks in the same parallel batch', async () => {
    installRouter([
      { id: 'a', description: 'task a', estimatedComplexity: 2 },
      { id: 'b', description: 'task b', estimatedComplexity: 2 },
    ]);

    const plan = await new Orchestrator().planWorkflow('two independent things');
    expect(plan.parallelBatches!).toHaveLength(1);
    expect(plan.parallelBatches![0]!.map(t => t.id).sort()).toEqual(['a', 'b']);
  });

  it('skips the clarify phase for a simple goal (no requirements.md written)', async () => {
    installRouter([{ id: 't1', description: 'trivial', estimatedComplexity: 1 }]);

    await new Orchestrator().planWorkflow('rename a variable');

    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'requirements.md'))).toBe(false);
    // gap assessment must have been consulted
    const gapCalls = mockAskLLM.mock.calls.filter(c => /ambiguityScore/.test(String(c[0])));
    expect(gapCalls.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to the two-task analyze/execute template when decomposition is unparseable', async () => {
    installRouter('this is not valid json at all');

    const plan = await new Orchestrator().planWorkflow('do something hard');

    expect(plan.tasks.map(t => t.id)).toEqual(['fallback-analyze-1', 'fallback-execute-2']);
    expect(plan.tasks).toHaveLength(2);
  });

  it('matches a goal template before invoking the LLM', async () => {
    const tDir = path.join(tmpDir, '.workflow', 'templates');
    fs.mkdirSync(tDir, { recursive: true });
    fs.writeFileSync(
      path.join(tDir, 'deploy.json'),
      JSON.stringify({ subtasks: [{ id: 's1', description: 'templated step', expectedOutput: 'done' }] }),
      'utf-8'
    );
    installRouter([{ id: 'should-not-be-used', description: 'x' }]);

    const plan = await new Orchestrator().planWorkflow('Template: deploy');

    expect(plan.tasks.map(t => t.id)).toEqual(['s1']);
    expect(mockAskLLM).not.toHaveBeenCalled(); // template short-circuits the LLM
  });
});
