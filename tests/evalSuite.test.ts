import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EvalSuite } from '../src/core/evalSuite';

let tmpDir: string;
let suite: EvalSuite;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evalsuite-'));
  suite = new EvalSuite(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('EvalSuite — cases', () => {
  it('adds and loads cases (same id replaces)', () => {
    suite.addCase({ id: 'c1', goal: 'goal 1', assertions: [] });
    suite.addCase({ id: 'c1', goal: 'goal 1 updated', assertions: [] });
    const cases = suite.loadCases();
    expect(cases).toHaveLength(1);
    expect(cases[0]!.goal).toBe('goal 1 updated');
  });

  it('ignores malformed case entries', () => {
    const dir = path.join(tmpDir, '.workflow', 'eval_suite');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cases.json'), JSON.stringify([
      { id: 'valid', goal: 'g', assertions: [] },
      { id: 'no-goal' },
      'garbage',
    ]), 'utf-8');
    expect(suite.loadCases().map(c => c.id)).toEqual(['valid']);
  });
});

describe('EvalSuite — run & assertions', () => {
  it('passes when the runner produces expected files', async () => {
    suite.addCase({
      id: 'creates-file',
      goal: 'create out.txt',
      assertions: [
        { type: 'file_exists', path: 'out.txt' },
        { type: 'file_contains', path: 'out.txt', text: 'hello' },
      ],
    });

    const runner = vi.fn(async () => {
      fs.writeFileSync(path.join(tmpDir, 'out.txt'), 'hello world', 'utf-8');
    });

    const result = await suite.run(runner, 'baseline');
    expect(result.passed).toBe(1);
    expect(result.label).toBe('baseline');
    expect(runner).toHaveBeenCalledWith('create out.txt');
  });

  it('fails with reasons when assertions are not met', async () => {
    suite.addCase({
      id: 'missing-file',
      goal: 'whatever',
      assertions: [{ type: 'file_exists', path: 'never.txt' }],
    });

    const result = await suite.run(async () => {});
    expect(result.passed).toBe(0);
    expect(result.results[0]!.failures[0]).toContain('never.txt');
  });

  it('a runner exception fails the case but the suite continues', async () => {
    suite.addCase({ id: 'boom', goal: 'explode', assertions: [] });
    suite.addCase({ id: 'fine', goal: 'ok', assertions: [] });

    const runner = vi.fn(async (goal: string) => {
      if (goal === 'explode') throw new Error('LLM unavailable');
    });

    const result = await suite.run(runner);
    expect(result.total).toBe(2);
    expect(result.passed).toBe(1);
    expect(result.results.find(r => r.caseId === 'boom')!.failures[0]).toContain('runner error');
  });

  it('command_succeeds assertion executes in the suite cwd', async () => {
    suite.addCase({
      id: 'cmd',
      goal: 'noop',
      assertions: [{ type: 'command_succeeds', command: 'node -e "process.exit(0)"' }],
    });
    const result = await suite.run(async () => {});
    expect(result.passed).toBe(1);
  });
});

describe('EvalSuite — history & comparison', () => {
  it('detects regressions and improvements between runs', async () => {
    suite.addCase({ id: 'a', goal: 'a', assertions: [{ type: 'file_exists', path: 'a.txt' }] });
    suite.addCase({ id: 'b', goal: 'b', assertions: [{ type: 'file_exists', path: 'b.txt' }] });

    // Run 1: a 过 b 挂
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'x');
    await suite.run(async () => {}, 'run1');

    // Run 2: a 挂 b 过
    fs.unlinkSync(path.join(tmpDir, 'a.txt'));
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'x');
    await suite.run(async () => {}, 'run2');

    const comparison = suite.compareWithPrevious()!;
    expect(comparison.regressions).toEqual(['a']);
    expect(comparison.improvements).toEqual(['b']);
    expect(comparison.previous!.label).toBe('run1');
  });

  it('keeps at most 20 results in history', async () => {
    suite.addCase({ id: 'x', goal: 'x', assertions: [] });
    for (let i = 0; i < 25; i++) {
      await suite.run(async () => {}, `run${i}`);
    }
    const history = suite.getHistory();
    expect(history).toHaveLength(20);
    expect(history[history.length - 1]!.label).toBe('run24');
  });

  it('returns null comparison when no runs exist', () => {
    expect(suite.compareWithPrevious()).toBeNull();
  });
});
