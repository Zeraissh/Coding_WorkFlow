import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { WorkflowTracer, estimateCostUsd } from '../src/core/tracer';
import { workflowEvents } from '../src/core/events';

describe('estimateCostUsd', () => {
  it('prices uncached input, cached input, and output by model rate', () => {
    // sonnet: input $3/M, cached $0.30/M, output $15/M
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedTokens: 0 },
      'claude-sonnet-4-6'
    );
    expect(cost).toBeCloseTo(18, 5); // 3 + 15
  });

  it('applies the cached discount to the cached portion', () => {
    const cost = estimateCostUsd(
      { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 1_000_000 },
      'claude-sonnet-4-6'
    );
    expect(cost).toBeCloseTo(0.3, 5); // all input cached → $0.30
  });

  it('charges opus tier higher than sonnet', () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 };
    expect(estimateCostUsd(usage, 'claude-opus-4-8')).toBeGreaterThan(
      estimateCostUsd(usage, 'claude-sonnet-4-6')
    );
  });

  it('falls back to a default rate for unknown models', () => {
    const cost = estimateCostUsd({ inputTokens: 1_000_000, outputTokens: 0, cachedTokens: 0 }, 'mystery-model');
    expect(cost).toBeCloseTo(3, 5);
  });
});

describe('WorkflowTracer', () => {
  let tmpDir: string;
  let tracer: WorkflowTracer;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tracer-'));
    tracer = new WorkflowTracer(tmpDir);
  });

  afterEach(() => {
    tracer.dispose();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function runWorkflow() {
    workflowEvents.emit('workflowStarted', { goal: 'build a thing', totalTasks: 2 });
    workflowEvents.emit('taskStarted', { taskId: 't1', description: 'first' });
    workflowEvents.emit('llmUsageReport', {
      taskId: 't1', tokens: 3000, inputTokens: 2000, outputTokens: 1000, cachedTokens: 500, calls: 1, model: 'claude-sonnet-4-6',
    });
    workflowEvents.emit('fileChanged', { taskId: 't1', file: 'a.ts' });
    workflowEvents.emit('focusUpdate', { taskId: 't1', score: 75 });
    workflowEvents.emit('taskCompleted', { taskId: 't1', success: true });
    // an orchestrator-level call counts in totals but not in any task bucket
    workflowEvents.emit('llmUsageReport', {
      taskId: 'orchestrator', tokens: 1000, inputTokens: 800, outputTokens: 200, cachedTokens: 0, calls: 1, model: 'claude-sonnet-4-6',
    });
    workflowEvents.emit('workflowCompleted', {});
  }

  it('assembles a structured trace and writes it to .workflow/traces', () => {
    runWorkflow();
    const trace = tracer.getCurrentTrace()!;

    expect(trace.goal).toBe('build a thing');
    expect(trace.durationMs).not.toBeNull();
    expect(trace.totals.llmCalls).toBe(2);
    expect(trace.totals.tokens).toBe(4000);
    expect(trace.totals.cachedTokens).toBe(500);
    expect(trace.totals.estimatedCostUsd).toBeGreaterThan(0);

    const t1 = trace.tasks.find(t => t.taskId === 't1')!;
    expect(t1.status).toBe('completed');
    expect(t1.tokens).toBe(3000);
    expect(t1.filesChanged).toEqual(['a.ts']);
    expect(t1.focusScore).toBe(75);

    const files = fs.readdirSync(path.join(tmpDir, '.workflow', 'traces'));
    expect(files.some(f => f.endsWith('.json'))).toBe(true);
  });

  it('emits a costReport on completion', () => {
    const reports: any[] = [];
    const listener = (d: any) => reports.push(d);
    workflowEvents.on('costReport', listener);
    try {
      runWorkflow();
    } finally {
      workflowEvents.off('costReport', listener);
    }
    expect(reports).toHaveLength(1);
    expect(reports[0].estimatedCostUsd).toBeGreaterThan(0);
    expect(reports[0].tokens).toBe(4000);
  });

  it('marks stopped workflows', () => {
    workflowEvents.emit('workflowStarted', { goal: 'x' });
    workflowEvents.emit('workflowStopped', { reason: 'user' });
    workflowEvents.emit('workflowCompleted', {});
    expect(tracer.getCurrentTrace()!.stopped).toBe(true);
  });

  it('dispose detaches listeners (no further mutation)', () => {
    runWorkflow();
    const before = tracer.getCurrentTrace()!.workflowId;
    tracer.dispose();
    workflowEvents.emit('workflowStarted', { goal: 'should be ignored' });
    expect(tracer.getCurrentTrace()!.workflowId).toBe(before);
  });
});
