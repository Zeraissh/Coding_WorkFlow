/**
 * EvalSuite — 回归评测集（P2.5-A.4）
 *
 * 用途：任何提示词/规则/skill 变更前后跑同一组用例，对比成功率——
 * "影子验证"的执行底座。没有可复现的评测，自我迭代就是盲调。
 *
 * 用例：.workflow/eval_suite/cases.json
 *   [{ "id": "...", "goal": "...", "assertions": [
 *      { "type": "file_exists", "path": "out.py" },
 *      { "type": "file_contains", "path": "out.py", "text": "def main" },
 *      { "type": "command_succeeds", "command": "python -m pytest tests/ -q" } ] }]
 *
 * 结果：.workflow/eval_suite/results.json（保留最近 20 次，原子写），
 * compareWithPrevious() 输出与上一次运行的回归/改进对比。
 */

import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { assertCommandAllowed } from './security';

const execAsync = promisify(exec);

export type EvalAssertion =
  | { type: 'file_exists'; path: string }
  | { type: 'file_contains'; path: string; text: string }
  | { type: 'command_succeeds'; command: string };

export interface EvalCase {
  id: string;
  goal: string;
  assertions: EvalAssertion[];
}

export interface CaseResult {
  caseId: string;
  passed: boolean;
  failures: string[];
  durationMs: number;
}

export interface SuiteResult {
  timestamp: number;
  /** 运行时的上下文标识（规则 hash / 提示词版本等），供归因 */
  label: string;
  total: number;
  passed: number;
  results: CaseResult[];
}

export interface SuiteComparison {
  current: SuiteResult;
  previous: SuiteResult | null;
  /** 上次通过、这次失败的用例 id */
  regressions: string[];
  /** 上次失败、这次通过的用例 id */
  improvements: string[];
}

export class EvalSuite {
  private dir: string;
  private casesFile: string;
  private resultsFile: string;
  private cwd: string;

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.dir = path.join(cwd, '.workflow', 'eval_suite');
    this.casesFile = path.join(this.dir, 'cases.json');
    this.resultsFile = path.join(this.dir, 'results.json');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  loadCases(): EvalCase[] {
    if (!fs.existsSync(this.casesFile)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.casesFile, 'utf-8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (c): c is EvalCase =>
          c && typeof c.id === 'string' && typeof c.goal === 'string' && Array.isArray(c.assertions)
      );
    } catch {
      return [];
    }
  }

  addCase(evalCase: EvalCase): void {
    this.ensureDir();
    const cases = this.loadCases().filter(c => c.id !== evalCase.id);
    cases.push(evalCase);
    const tmp = `${this.casesFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(cases, null, 2), 'utf-8');
    fs.renameSync(tmp, this.casesFile);
  }

  /** 执行单条断言，失败返回原因，通过返回 null */
  private async checkAssertion(assertion: EvalAssertion): Promise<string | null> {
    switch (assertion.type) {
      case 'file_exists': {
        const p = path.resolve(this.cwd, assertion.path);
        return fs.existsSync(p) ? null : `file_exists failed: ${assertion.path} not found`;
      }
      case 'file_contains': {
        const p = path.resolve(this.cwd, assertion.path);
        if (!fs.existsSync(p)) return `file_contains failed: ${assertion.path} not found`;
        const content = fs.readFileSync(p, 'utf-8');
        return content.includes(assertion.text)
          ? null
          : `file_contains failed: "${assertion.text.slice(0, 60)}" not in ${assertion.path}`;
      }
      case 'command_succeeds': {
        try {
          assertCommandAllowed(assertion.command);
          await execAsync(assertion.command, { cwd: this.cwd, timeout: 120_000 });
          return null;
        } catch (e: any) {
          return `command_succeeds failed: ${assertion.command} → ${(e.message || '').slice(0, 120)}`;
        }
      }
      default:
        return `unknown assertion type: ${(assertion as any).type}`;
    }
  }

  /**
   * 跑全套用例。runner 通常是 `(goal) => orchestrator.executeWorkflow(goal)`，
   * 测试中可注入任意 mock。runner 抛错记为该用例失败，套件继续。
   */
  async run(runner: (goal: string) => Promise<unknown>, label: string = ''): Promise<SuiteResult> {
    const cases = this.loadCases();
    const results: CaseResult[] = [];

    for (const c of cases) {
      const start = Date.now();
      const failures: string[] = [];
      try {
        await runner(c.goal);
        for (const assertion of c.assertions) {
          const failure = await this.checkAssertion(assertion);
          if (failure) failures.push(failure);
        }
      } catch (e: any) {
        failures.push(`runner error: ${(e.message || String(e)).slice(0, 200)}`);
      }
      results.push({
        caseId: c.id,
        passed: failures.length === 0,
        failures,
        durationMs: Date.now() - start,
      });
    }

    const suiteResult: SuiteResult = {
      timestamp: Date.now(),
      label,
      total: results.length,
      passed: results.filter(r => r.passed).length,
      results,
    };
    this.saveResult(suiteResult);
    return suiteResult;
  }

  private loadHistory(): SuiteResult[] {
    if (!fs.existsSync(this.resultsFile)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.resultsFile, 'utf-8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveResult(result: SuiteResult): void {
    this.ensureDir();
    const history = this.loadHistory();
    history.push(result);
    const tmp = `${this.resultsFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(history.slice(-20), null, 2), 'utf-8');
    fs.renameSync(tmp, this.resultsFile);
  }

  getHistory(): SuiteResult[] {
    return this.loadHistory();
  }

  /** 最近一次 vs 上一次：哪些用例回归、哪些改进 */
  compareWithPrevious(): SuiteComparison | null {
    const history = this.loadHistory();
    if (history.length === 0) return null;
    const current = history[history.length - 1]!;
    const previous = history.length >= 2 ? history[history.length - 2]! : null;

    const regressions: string[] = [];
    const improvements: string[] = [];
    if (previous) {
      const prevMap = new Map(previous.results.map(r => [r.caseId, r.passed]));
      for (const r of current.results) {
        const prevPassed = prevMap.get(r.caseId);
        if (prevPassed === true && !r.passed) regressions.push(r.caseId);
        if (prevPassed === false && r.passed) improvements.push(r.caseId);
      }
    }
    return { current, previous, regressions, improvements };
  }
}
