import { describe, it, expect, vi } from 'vitest';
import { Decomposer } from '../src/core/orchestrator/decomposer';
import type { Subtask } from '../src/core/orchestrator/types';

function asJsonBlock(subtasks: Partial<Subtask>[]): string {
  return '```json\n' + JSON.stringify(subtasks) + '\n```';
}

function makeDecomposer(responses: string[], config: object = {}) {
  let call = 0;
  const callLLM = vi.fn(async () => responses[Math.min(call++, responses.length - 1)] ?? '');
  return { decomposer: new Decomposer({ callLLM }, { enableSelfCheck: false, ...config }), callLLM };
}

describe('Decomposer.decompose', () => {
  it('parses subtasks from a json code block and batches independent tasks together', async () => {
    const { decomposer } = makeDecomposer([
      asJsonBlock([
        { id: 'a', description: 'task a', estimatedComplexity: 3 },
        { id: 'b', description: 'task b', estimatedComplexity: 4 },
        { id: 'c', description: 'task c', estimatedComplexity: 5, dependencies: ['a', 'b'] },
      ]),
    ]);

    const result = await decomposer.decompose('do something');
    expect(result.subtasks).toHaveLength(3);
    expect(result.parallelBatches).toHaveLength(2);
    expect(result.parallelBatches[0]!.map(t => t.id).sort()).toEqual(['a', 'b']);
    expect(result.parallelBatches[1]!.map(t => t.id)).toEqual(['c']);
  });

  it('topologically orders chained dependencies into sequential batches', async () => {
    const { decomposer } = makeDecomposer([
      asJsonBlock([
        { id: 'c', description: 'last', dependencies: ['b'] },
        { id: 'a', description: 'first' },
        { id: 'b', description: 'middle', dependencies: ['a'] },
      ]),
    ]);

    const result = await decomposer.decompose('chained goal');
    expect(result.parallelBatches.map(batch => batch.map(t => t.id))).toEqual([['a'], ['b'], ['c']]);
  });

  it('degrades to sequential execution when the dependency graph has a cycle', async () => {
    const { decomposer } = makeDecomposer([
      asJsonBlock([
        { id: 'a', description: 'a', dependencies: ['b'] },
        { id: 'b', description: 'b', dependencies: ['a'] },
      ]),
    ]);

    const result = await decomposer.decompose('cyclic goal');
    expect(result.warnings.some(w => w.includes('循环依赖'))).toBe(true);
    // 退化为逐个执行：每批恰好一个任务
    expect(result.parallelBatches).toHaveLength(2);
    expect(result.parallelBatches.every(batch => batch.length === 1)).toBe(true);
  });

  it('falls back to the two-task template after repeated unparseable responses', async () => {
    const { decomposer, callLLM } = makeDecomposer(['not json at all', 'still not json']);

    const result = await decomposer.decompose('unparseable goal');
    expect(callLLM).toHaveBeenCalledTimes(2);
    expect(result.subtasks.map(t => t.id)).toEqual(['fallback-analyze-1', 'fallback-execute-2']);
    expect(result.parallelBatches).toHaveLength(2);
  });

  it('truncates subtasks above maxSubtasks and records a warning', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, description: `task ${i}` }));
    const { decomposer } = makeDecomposer([asJsonBlock(many)], { maxSubtasks: 4 });

    const result = await decomposer.decompose('big goal');
    expect(result.subtasks).toHaveLength(4);
    expect(result.warnings.some(w => w.includes('超过上限'))).toBe(true);
  });

  it('clamps complexity into [1,10] and defaults missing fields', async () => {
    const { decomposer } = makeDecomposer([
      asJsonBlock([{ id: 'x', description: 'x', estimatedComplexity: 42 }]),
    ]);

    const result = await decomposer.decompose('goal');
    const task = result.subtasks[0]!;
    expect(task.estimatedComplexity).toBe(10);
    expect(task.dependencies).toEqual([]);
    expect(task.isolatedFiles).toEqual([]);
    expect(task.expectedOutput).toBe('');
  });

  it('applies self-check missing dependencies when enabled', async () => {
    const decomposeResponse = asJsonBlock([
      { id: 'a', description: 'a' },
      { id: 'b', description: 'b' },
    ]);
    const selfCheckResponse = '```json\n' + JSON.stringify({
      missingDependencies: [{ from: 'b', to: 'a', reason: 'b builds on a' }],
      fileConflicts: [],
      overlyCoarse: [],
      overlyFine: [],
      warnings: [],
    }) + '\n```';

    const { decomposer } = makeDecomposer([decomposeResponse, selfCheckResponse], { enableSelfCheck: true });

    const result = await decomposer.decompose('goal');
    const b = result.subtasks.find(t => t.id === 'b')!;
    expect(b.dependencies).toContain('a');
    expect(result.parallelBatches.map(batch => batch.map(t => t.id))).toEqual([['a'], ['b']]);
  });

  it('resolves self-check file conflicts by downgrading the lower-complexity task to read-only', async () => {
    const decomposeResponse = asJsonBlock([
      { id: 'a', description: 'a', estimatedComplexity: 8, isolatedFiles: ['shared.ts'] },
      { id: 'b', description: 'b', estimatedComplexity: 3, isolatedFiles: ['shared.ts'] },
    ]);
    const selfCheckResponse = '```json\n' + JSON.stringify({
      missingDependencies: [],
      fileConflicts: [{ file: 'shared.ts', taskA: 'a', taskB: 'b' }],
      overlyCoarse: [],
      overlyFine: [],
      warnings: [],
    }) + '\n```';

    const { decomposer } = makeDecomposer([decomposeResponse, selfCheckResponse], { enableSelfCheck: true });

    const result = await decomposer.decompose('goal');
    const a = result.subtasks.find(t => t.id === 'a')!;
    const b = result.subtasks.find(t => t.id === 'b')!;
    expect(a.isolatedFiles).toContain('shared.ts');
    expect(b.isolatedFiles).not.toContain('shared.ts');
    expect(b.sharedFiles).toContain('shared.ts');
  });
});
