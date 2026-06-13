import { describe, it, expect } from 'vitest';
import { failedDependencyOf } from '../src/core/orchestrator';

describe('failedDependencyOf — DAG failure propagation', () => {
  it('returns undefined when all dependencies succeeded', () => {
    const success = new Map([['a', true], ['b', true]]);
    expect(failedDependencyOf({ dependencies: ['a', 'b'] }, success)).toBeUndefined();
  });

  it('returns the failed dependency id when a prerequisite did not succeed', () => {
    const success = new Map([['a', true], ['b', false]]);
    expect(failedDependencyOf({ dependencies: ['a', 'b'] }, success)).toBe('b');
  });

  it('propagates transitively: a skipped dep (recorded as false) also blocks', () => {
    // b was itself skipped because its own dep failed → b=false → c is blocked by b
    const success = new Map([['a', false], ['b', false]]);
    expect(failedDependencyOf({ dependencies: ['b'] }, success)).toBe('b');
  });

  it('returns undefined for a task with no dependencies', () => {
    expect(failedDependencyOf({}, new Map())).toBeUndefined();
    expect(failedDependencyOf({ dependencies: [] }, new Map())).toBeUndefined();
  });

  it('does not skip when a dependency is unknown (safe default — only skip on confirmed failure)', () => {
    const success = new Map([['a', true]]);
    expect(failedDependencyOf({ dependencies: ['ghost'] }, success)).toBeUndefined();
  });

  it('reports the first failed dependency when several failed', () => {
    const success = new Map([['a', true], ['b', false], ['c', false]]);
    expect(failedDependencyOf({ dependencies: ['a', 'b', 'c'] }, success)).toBe('b');
  });
});
