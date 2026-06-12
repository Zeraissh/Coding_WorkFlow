import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Evaluator } from '../src/core/evaluator';
import { workflowEvents } from '../src/core/events';

let tmpDir: string;
let evaluator: Evaluator;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'eval-'));
  evaluator = new Evaluator(tmpDir);
});

afterEach(() => {
  evaluator.dispose();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function runWorkflow(opts: {
  tasks: Array<{ taskId: string; success: boolean; agentId?: string; errors?: string[] }>;
  verification?: any;
  interventions?: Array<{ taskId: string }>;
  stopped?: boolean;
}) {
  workflowEvents.emit('workflowStarted', {});
  for (const t of opts.tasks) {
    workflowEvents.emit('taskCompleted', {
      taskId: t.taskId,
      success: t.success,
      agentId: t.agentId,
      executionLog: { errors: t.errors || [] },
    });
  }
  for (const i of opts.interventions || []) {
    workflowEvents.emit('focusIntervention', i);
  }
  if (opts.verification) workflowEvents.emit('verificationReport', opts.verification);
  if (opts.stopped) workflowEvents.emit('workflowStopped', { reason: 'test' });
  workflowEvents.emit('llmUsageReport', { tokens: 1000, cachedTokens: 500, calls: 2 });
  workflowEvents.emit('workflowCompleted', {});
}

describe('Evaluator attribution', () => {
  it('records per-task details with error counts', () => {
    runWorkflow({
      tasks: [
        { taskId: 't1', success: true, agentId: 'a1' },
        { taskId: 't2', success: false, agentId: 'a2', errors: ['boom', 'crash'] },
      ],
    });

    const { records } = evaluator.getLogs();
    expect(records).toHaveLength(1);
    const rec = records[0]!;
    expect(rec.totalTasks).toBe(2);
    expect(rec.successfulTasks).toBe(1);
    expect(rec.tasks).toHaveLength(2);
    expect(rec.tasks[1]).toMatchObject({ taskId: 't2', success: false, errorCount: 2 });
    expect(rec.promptVersion).toBeGreaterThanOrEqual(1);
    expect(rec.stopped).toBe(false);
  });

  it('captures the verification summary', () => {
    runWorkflow({
      tasks: [{ taskId: 't1', success: true }],
      verification: { passed: false, lintErrors: 3, typeErrors: 1, fileConflicts: 0, interfaceMismatches: 0, semanticIssues: 2 },
    });

    const rec = evaluator.getLogs().records[0]!;
    expect(rec.verification).toMatchObject({ passed: false, lintErrors: 3, semanticIssues: 2 });
  });

  it('counts focus interventions per task', () => {
    runWorkflow({
      tasks: [{ taskId: 't1', success: true }],
      interventions: [{ taskId: 't1' }, { taskId: 't1' }],
    });

    expect(evaluator.getLogs().records[0]!.tasks[0]!.interventions).toBe(2);
  });

  it('marks E-Stopped workflows', () => {
    runWorkflow({ tasks: [{ taskId: 't1', success: true }], stopped: true });
    expect(evaluator.getLogs().records[0]!.stopped).toBe(true);
  });

  it('records the rules hash (none when no rules file)', () => {
    runWorkflow({ tasks: [{ taskId: 't1', success: true }] });
    expect(evaluator.getLogs().records[0]!.rulesHash).toBe('none');
  });

  it('rules hash changes when rules content changes', () => {
    fs.mkdirSync(path.join(tmpDir, '.workflow'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.workflow', 'project_rules.md'), 'rule A', 'utf-8');
    runWorkflow({ tasks: [{ taskId: 't1', success: true }] });

    fs.writeFileSync(path.join(tmpDir, '.workflow', 'project_rules.md'), 'rule B', 'utf-8');
    runWorkflow({ tasks: [{ taskId: 't2', success: true }] });

    const { records } = evaluator.getLogs();
    expect(records[0]!.rulesHash).not.toBe('none');
    expect(records[0]!.rulesHash).not.toBe(records[1]!.rulesHash);
  });

  it('quality score weighs success rate, not cache hit rate', () => {
    runWorkflow({
      tasks: [
        { taskId: 't1', success: true },
        { taskId: 't2', success: true },
        { taskId: 't3', success: false },
        { taskId: 't4', success: false },
      ],
    });
    // 成功率 50%，无验证数据 → verifyRate 回退到成功率 → 总分 50
    expect(evaluator.calculateQualityScore()).toBe(50);
  });

  it('persists logs atomically to eval_logs.json', () => {
    runWorkflow({ tasks: [{ taskId: 't1', success: true }] });
    const logFile = path.join(tmpDir, '.workflow', 'eval_logs.json');
    expect(fs.existsSync(logFile)).toBe(true);
    expect(fs.existsSync(logFile + '.tmp')).toBe(false);
    const parsed = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
    expect(parsed).toHaveLength(1);
  });
});
