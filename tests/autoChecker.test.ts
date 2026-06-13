import { describe, it, expect } from 'vitest';
import { AutoChecker } from '../src/core/verifier/autoChecker';
import type { AgentExecutionLog } from '../src/types/workflow';

type ShellResult = { stdout: string; stderr: string; exitCode: number };

interface FakeDeps {
  shell?: (cmd: string) => ShellResult;
  exists?: (p: string) => boolean;
  read?: (p: string) => string;
}

const CWD = '/proj';

function makeChecker(fake: FakeDeps = {}) {
  return new AutoChecker(
    {
      runShell: async (cmd: string) => fake.shell ? fake.shell(cmd) : { stdout: '', stderr: '', exitCode: 1 },
      readFile: async (p: string) => (fake.read ? fake.read(p) : ''),
      fileExists: async (p: string) => (fake.exists ? fake.exists(p) : false),
      cwd: CWD,
    },
    { autoCheck: true, semanticReview: false, autoFix: false }
  );
}

function writeLog(agentId: string, filePath: string): AgentExecutionLog {
  return {
    agentId,
    subtaskId: 't',
    files: [{ agentId, subtaskId: 't', operation: 'write', filePath, content: '', timestamp: Date.now() }],
    shellCommands: [],
    llmCalls: 1,
    tokensUsed: 0,
    errors: [],
  } as AgentExecutionLog;
}

describe('AutoChecker.check — clean project', () => {
  it('passes when no linters/types/tests are configured', async () => {
    // eslint --version fails (not installed), no tsconfig, no test config
    const checker = makeChecker({ shell: () => ({ stdout: '', stderr: '', exitCode: 1 }) });
    const result = await checker.check([writeLog('a1', 'src/x.ts')]);

    expect(result.passed).toBe(true);
    expect(result.lintErrors).toHaveLength(0);
    expect(result.typeErrors).toHaveLength(0);
    expect(result.fileConflicts).toHaveLength(0);
    expect(result.testResults).toBeNull();
  });
});

describe('AutoChecker.check — file conflicts', () => {
  it('flags a file written by two different agents', async () => {
    const checker = makeChecker();
    const result = await checker.check([writeLog('a1', 'src/shared.ts'), writeLog('a2', 'src/shared.ts')]);

    expect(result.fileConflicts).toHaveLength(1);
    expect(result.fileConflicts[0]!.file).toBe('src/shared.ts');
    expect(result.fileConflicts[0]!.agents.sort()).toEqual(['a1', 'a2']);
    expect(result.passed).toBe(false);
  });

  it('does not flag a file written by a single agent', async () => {
    const checker = makeChecker();
    const result = await checker.check([writeLog('a1', 'src/solo.ts')]);
    expect(result.fileConflicts).toHaveLength(0);
  });
});

describe('AutoChecker.check — eslint parsing', () => {
  it('parses eslint JSON output into structured lint errors', async () => {
    const eslintJson = JSON.stringify([
      {
        filePath: '/proj/src/x.ts',
        messages: [
          { ruleId: 'no-unused-vars', severity: 2, message: "'y' is defined but never used.", line: 3, column: 7 },
        ],
      },
    ]);
    const checker = makeChecker({
      shell: (cmd) => {
        if (cmd.includes('eslint --version')) return { stdout: 'v9.0.0', stderr: '', exitCode: 0 };
        if (cmd.includes('eslint --format json')) return { stdout: eslintJson, stderr: '', exitCode: 1 };
        return { stdout: '', stderr: '', exitCode: 1 };
      },
    });

    const result = await checker.check([writeLog('a1', 'src/x.ts')]);
    expect(result.lintErrors).toHaveLength(1);
    expect(result.lintErrors[0]).toMatchObject({ file: '/proj/src/x.ts', line: 3, rule: 'no-unused-vars' });
    expect(result.passed).toBe(false);
  });
});

describe('AutoChecker.check — tsc parsing', () => {
  it('parses tsc errors when a tsconfig is present and tsc fails', async () => {
    const tscOut = "src/x.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.";
    const checker = makeChecker({
      exists: (p) => p === `${CWD}/tsconfig.json`,
      shell: (cmd) => {
        if (cmd.includes('eslint --version')) return { stdout: '', stderr: '', exitCode: 1 }; // no eslint
        if (cmd.includes('tsc --noEmit')) return { stdout: tscOut, stderr: '', exitCode: 1 };
        return { stdout: '', stderr: '', exitCode: 1 };
      },
    });

    const result = await checker.check([writeLog('a1', 'src/x.ts')]);
    expect(result.typeErrors).toHaveLength(1);
    expect(result.typeErrors[0]).toMatchObject({ file: 'src/x.ts', line: 10, code: 2322 });
    expect(result.passed).toBe(false);
  });

  it('reports no type errors when tsc passes', async () => {
    const checker = makeChecker({
      exists: (p) => p === `${CWD}/tsconfig.json`,
      shell: (cmd) => {
        if (cmd.includes('tsc --noEmit')) return { stdout: '', stderr: '', exitCode: 0 };
        return { stdout: '', stderr: '', exitCode: 1 };
      },
    });
    const result = await checker.check([writeLog('a1', 'src/x.ts')]);
    expect(result.typeErrors).toHaveLength(0);
  });
});
