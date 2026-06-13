import { describe, it, expect } from 'vitest';
import { runExclusiveWorkflow, isWorkflowRunning } from '../src/core/workflowLock';

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

describe('runExclusiveWorkflow — serializes workflows in-process', () => {
  it('does not interleave two overlapping workflows', async () => {
    const order: string[] = [];
    const a = runExclusiveWorkflow(async () => {
      order.push('A-start');
      await delay(25);
      order.push('A-end');
    });
    const b = runExclusiveWorkflow(async () => {
      order.push('B-start');
      order.push('B-end');
    });
    await Promise.all([a, b]);
    // B must wait for A to fully finish, not interleave
    expect(order).toEqual(['A-start', 'A-end', 'B-start', 'B-end']);
  });

  it('a failing workflow does not jam the queue', async () => {
    await expect(runExclusiveWorkflow(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    await expect(runExclusiveWorkflow(async () => 'ok')).resolves.toBe('ok');
  });

  it('reports running state during execution and clears after', async () => {
    expect(isWorkflowRunning()).toBe(false);
    let seenRunning = false;
    await runExclusiveWorkflow(async () => { seenRunning = isWorkflowRunning(); });
    expect(seenRunning).toBe(true);
    expect(isWorkflowRunning()).toBe(false);
  });

  it('returns each workflow its own result', async () => {
    const [x, y] = await Promise.all([
      runExclusiveWorkflow(async () => 1),
      runExclusiveWorkflow(async () => 2),
    ]);
    expect([x, y]).toEqual([1, 2]);
  });
});
