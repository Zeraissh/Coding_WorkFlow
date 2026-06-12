import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FocusMonitor } from '../src/core/focus';
import { workflowEvents } from '../src/core/events';

const task = {
  id: 't1',
  description: 'Implement the parser module',
  isolatedFiles: ['src/parser.ts'],
  sharedFiles: ['src/types.ts'],
};

let interventions: any[] = [];
let updates: any[] = [];
const onIntervention = (d: any) => interventions.push(d);
const onUpdate = (d: any) => updates.push(d);

beforeEach(() => {
  interventions = [];
  updates = [];
  workflowEvents.on('focusIntervention', onIntervention);
  workflowEvents.on('focusUpdate', onUpdate);
});

afterEach(() => {
  workflowEvents.off('focusIntervention', onIntervention);
  workflowEvents.off('focusUpdate', onUpdate);
});

describe('FocusMonitor — out-of-scope writes', () => {
  it('warns when writing outside declared files (once per path)', () => {
    const m = new FocusMonitor(task, 'agent-1');
    expect(m.recordToolCall('write_file', { path: 'src/parser.ts', content: 'x' })).toBeUndefined();
    expect(m.recordToolCall('edit_file', { path: 'src/unrelated.ts', search: 'a', replace: 'b' })).toContain('OUTSIDE');

    // 同一路径只警告一次
    expect(m.recordToolCall('edit_file', { path: 'src/unrelated.ts', search: 'c', replace: 'd' })).toBeUndefined();
    expect(interventions.filter(i => i.type === 'out_of_scope_write')).toHaveLength(1);
    expect(m.getScore()).toBe(75);
  });

  it('matches absolute paths against relative declarations', () => {
    const m = new FocusMonitor(task, 'agent-1');
    expect(m.recordToolCall('write_file', { path: 'D:\\proj\\src\\parser.ts', content: 'x' })).toBeUndefined();
  });

  it('does not check tasks without file declarations', () => {
    const m = new FocusMonitor({ id: 't2', description: 'free task', isolatedFiles: [], sharedFiles: [] }, 'agent-2');
    expect(m.recordToolCall('write_file', { path: 'anything.ts', content: 'x' })).toBeUndefined();
    expect(m.getScore()).toBe(100);
  });
});

describe('FocusMonitor — loop detection', () => {
  it('warns on the 3rd identical call and emits an intervention', () => {
    const m = new FocusMonitor(task, 'agent-1');
    const args = { pattern: 'foo', dirPath: '.' };
    expect(m.recordToolCall('grep_search', args)).toBeUndefined();
    expect(m.recordToolCall('grep_search', args)).toBeUndefined();
    const warning = m.recordToolCall('grep_search', args);
    expect(warning).toContain('identical arguments 3 times');
    expect(interventions.filter(i => i.type === 'loop_detected')).toHaveLength(1);
    expect(m.getScore()).toBe(75);
  });

  it('different arguments do not trigger the loop detector', () => {
    const m = new FocusMonitor(task, 'agent-1');
    expect(m.recordToolCall('grep_search', { pattern: 'a' })).toBeUndefined();
    expect(m.recordToolCall('grep_search', { pattern: 'b' })).toBeUndefined();
    expect(m.recordToolCall('grep_search', { pattern: 'c' })).toBeUndefined();
    expect(m.getScore()).toBe(100);
  });
});

describe('FocusMonitor — idle burn', () => {
  it('warns after many read-only calls with zero writes', () => {
    const m = new FocusMonitor(task, 'agent-1', { idleCallThreshold: 5 });
    let warned: string | undefined;
    for (let i = 0; i < 5; i++) {
      warned = m.recordToolCall('read_file', { path: `f${i}.ts` });
    }
    expect(warned).toContain('zero file output');
    expect(m.getSignals().idleBurn).toBe(true);
    expect(m.getScore()).toBe(85);
  });

  it('does not warn when the agent has written files', () => {
    const m = new FocusMonitor(task, 'agent-1', { idleCallThreshold: 5 });
    m.recordToolCall('write_file', { path: 'src/parser.ts', content: 'x' });
    for (let i = 0; i < 6; i++) {
      expect(m.recordToolCall('read_file', { path: `f${i}.ts` })).toBeUndefined();
    }
  });
});

describe('FocusMonitor — heavy intervention (C.2)', () => {
  it('shouldAbort triggers when the score collapses and emits focusEscalation once', () => {
    const escalations: any[] = [];
    const listener = (d: any) => escalations.push(d);
    workflowEvents.on('focusEscalation', listener);

    try {
      const m = new FocusMonitor(task, 'agent-1', { abortScoreThreshold: 60 });
      expect(m.shouldAbort()).toBe(false);

      // 一次越界写 + 一次循环 → 100 - 25 - 25 = 50 ≤ 60
      m.recordToolCall('write_file', { path: 'outside.ts', content: 'x' });
      const args = { pattern: 'p' };
      m.recordToolCall('grep_search', args);
      m.recordToolCall('grep_search', args);
      m.recordToolCall('grep_search', args);

      expect(m.shouldAbort()).toBe(true);
      expect(m.shouldAbort()).toBe(true); // 持续为 true
      expect(escalations).toHaveLength(1); // 事件只发一次
      expect(escalations[0]).toMatchObject({ taskId: 't1', agentId: 'agent-1' });
      // 升级也计入干预（进 A.1 归因）
      expect(interventions.some(i => i.type === 'focus_collapse_abort')).toBe(true);
    } finally {
      workflowEvents.off('focusEscalation', listener);
    }
  });

  it('abortScoreThreshold 0 disables heavy intervention', () => {
    const m = new FocusMonitor(task, 'agent-1', { abortScoreThreshold: 0 });
    m.recordToolCall('write_file', { path: 'outside1.ts', content: 'x' });
    m.recordToolCall('edit_file', { path: 'outside2.ts', search: 'a', replace: 'b' });
    m.recordToolCall('write_file', { path: 'outside3.ts', content: 'x' });
    m.recordToolCall('write_file', { path: 'outside4.ts', content: 'x' });
    expect(m.getScore()).toBe(0);
    expect(m.shouldAbort()).toBe(false);
  });
});

describe('FocusMonitor — events & config', () => {
  it('emits focusUpdate with score on every call', () => {
    const m = new FocusMonitor(task, 'agent-1');
    m.recordToolCall('read_file', { path: 'a.ts' });
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ taskId: 't1', agentId: 'agent-1', score: 100 });
  });

  it('is a no-op when disabled', () => {
    const m = new FocusMonitor(task, 'agent-1', { enabled: false });
    const args = { pattern: 'foo' };
    m.recordToolCall('grep_search', args);
    m.recordToolCall('grep_search', args);
    expect(m.recordToolCall('grep_search', args)).toBeUndefined();
    expect(updates).toHaveLength(0);
  });
});
