import { describe, it, expect, beforeEach } from 'vitest';
import {
  beginWorkflowAbortScope,
  endWorkflowAbortScope,
  getWorkflowSignal,
  isWorkflowStopped,
  stopWorkflow,
} from '../src/core/abort';
import { workflowEvents } from '../src/core/events';

beforeEach(() => {
  endWorkflowAbortScope();
});

describe('workflow abort (E-Stop)', () => {
  it('has no signal outside a workflow scope', () => {
    expect(getWorkflowSignal()).toBeUndefined();
    expect(isWorkflowStopped()).toBe(false);
    expect(stopWorkflow()).toBe(false); // 无活跃工作流时停不了
  });

  it('provides a live signal inside a scope and aborts on stop', () => {
    beginWorkflowAbortScope();
    const signal = getWorkflowSignal();
    expect(signal).toBeDefined();
    expect(signal!.aborted).toBe(false);

    expect(stopWorkflow('test stop')).toBe(true);
    expect(signal!.aborted).toBe(true);
    expect(isWorkflowStopped()).toBe(true);
  });

  it('emits workflowStopped exactly once (double stop is a no-op)', () => {
    beginWorkflowAbortScope();
    const events: any[] = [];
    const listener = (d: any) => events.push(d);
    workflowEvents.on('workflowStopped', listener);

    expect(stopWorkflow('first')).toBe(true);
    expect(stopWorkflow('second')).toBe(false);
    workflowEvents.off('workflowStopped', listener);

    expect(events).toHaveLength(1);
    expect(events[0].reason).toBe('first');
  });

  it('a new scope is independent of a previously stopped one', () => {
    beginWorkflowAbortScope();
    stopWorkflow();
    endWorkflowAbortScope();

    beginWorkflowAbortScope();
    expect(isWorkflowStopped()).toBe(false);
    expect(getWorkflowSignal()!.aborted).toBe(false);
  });
});
