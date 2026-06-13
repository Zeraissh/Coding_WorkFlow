import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { startWorkflowObservers } from '../src/core/observers';
import { workflowEvents } from '../src/core/events';

let tmpDir: string;

function emitFullRun() {
  workflowEvents.emit('workflowStarted', { goal: 'do a thing', totalTasks: 1 });
  workflowEvents.emit('taskStarted', { taskId: 't1', description: 'first' });
  workflowEvents.emit('llmUsageReport', {
    taskId: 't1', tokens: 1500, inputTokens: 1000, outputTokens: 500, cachedTokens: 0, calls: 1, model: 'claude-sonnet-4-6',
  });
  workflowEvents.emit('taskCompleted', { taskId: 't1', success: true, executionLog: { errors: [] } });
  workflowEvents.emit('verificationReport', { passed: true, lintErrors: 0, typeErrors: 0, fileConflicts: 0, interfaceMismatches: 0, semanticIssues: 0 });
  workflowEvents.emit('workflowCompleted', {});
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'observers-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('startWorkflowObservers — observability bound to the engine', () => {
  it('records both an eval log and a run trace for a full workflow (no server needed)', () => {
    const observers = startWorkflowObservers(tmpDir);
    try {
      emitFullRun();
    } finally {
      observers.dispose();
    }

    // Evaluator attribution log
    const evalLog = path.join(tmpDir, '.workflow', 'eval_logs.json');
    expect(fs.existsSync(evalLog)).toBe(true);
    const records = JSON.parse(fs.readFileSync(evalLog, 'utf-8'));
    expect(records).toHaveLength(1);
    expect(records[0].successfulTasks).toBe(1);
    expect(records[0].verification).toMatchObject({ passed: true });

    // Structured run trace
    const tracesDir = path.join(tmpDir, '.workflow', 'traces');
    expect(fs.existsSync(tracesDir)).toBe(true);
    expect(fs.readdirSync(tracesDir).some(f => f.endsWith('.json'))).toBe(true);
  });

  it('dispose detaches the observers (a later run is not recorded)', () => {
    const observers = startWorkflowObservers(tmpDir);
    emitFullRun();
    observers.dispose();

    emitFullRun(); // after dispose — should be ignored

    const records = JSON.parse(fs.readFileSync(path.join(tmpDir, '.workflow', 'eval_logs.json'), 'utf-8'));
    expect(records).toHaveLength(1); // still just the first run
  });
});
