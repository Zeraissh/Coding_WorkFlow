import { askLLM } from '../llm/client';
import { Plan, TaskResult, AgentExecutionLog } from '../types/workflow';
import { AutoChecker } from './verifier/autoChecker';
import { SemanticReviewer, generateSummary } from './verifier/semanticReviewer';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execAsync = promisify(exec);

export class Verifier {
  private autoChecker: AutoChecker;
  private semanticReviewer: SemanticReviewer;

  constructor() {
    this.autoChecker = new AutoChecker(
      {
        runShell: async (cmd, cwd) => {
          try {
            const { stdout, stderr } = await execAsync(cmd, { cwd: cwd || process.cwd() });
            return { stdout, stderr, exitCode: 0 };
          } catch (err: any) {
            return { stdout: err.stdout || '', stderr: err.stderr || '', exitCode: err.code || 1 };
          }
        },
        readFile: async (path) => fs.readFileSync(path, 'utf-8'),
        fileExists: async (path) => fs.existsSync(path),
        cwd: process.cwd(),
      },
      { autoCheck: true, semanticReview: true, autoFix: false }
    );

    this.semanticReviewer = new SemanticReviewer(
      {
        callLLM: async (prompt, opts) => {
          const response = await askLLM(
            prompt,
            [{ role: 'user', content: prompt }],
            undefined,
            undefined,
            opts?.temperature ?? 0.1,
            'verifier'
          );
          const textBlock = response.content.find(block => block.type === 'text');
          return (textBlock as any)?.text || '';
        },
      },
      { autoCheck: true, semanticReview: true, autoFix: false }
    );
  }

  async verifyAndSynthesize(
    plan: Plan,
    results: TaskResult[],
    agentLogs?: AgentExecutionLog[]
  ): Promise<string> {
    const startTime = Date.now();

    // --- 第一阶段: 自动化检查 ---
    let autoCheckResult = null;
    if (agentLogs && agentLogs.length > 0) {
      try {
        autoCheckResult = await this.autoChecker.check(agentLogs);
      } catch (err: any) {
        // 自动检查失败不阻塞流程
      }
    }

    // --- 第二阶段: 语义审查 ---
    let semanticIssues: any[] = [];
    if (agentLogs && agentLogs.length > 0) {
      try {
        semanticIssues = await this.semanticReviewer.review(agentLogs, autoCheckResult || undefined);
      } catch {
        // 语义审查失败不阻塞
      }
    }

    // --- 最终 LLM 合成 ---
    const autoCheckSummary = autoCheckResult
      ? `
## 自动检查结果
- Lint 错误: ${autoCheckResult.lintErrors.length} 个
- 类型错误: ${autoCheckResult.typeErrors.length} 个
- 文件冲突: ${autoCheckResult.fileConflicts.length} 个
- 接口不匹配: ${autoCheckResult.interfaceMismatches.length} 个
- 自动检查: ${autoCheckResult.passed ? '✅ 通过' : '❌ 存在问题'}`
      : '';

    const semanticSummary = semanticIssues.length > 0
      ? `\n## 语义审查发现问题\n${JSON.stringify(semanticIssues, null, 2)}`
      : '';

    const systemPrompt = `You are an expert verifier and synthesizer.
Your task is to review the results of parallel sub-tasks and synthesize them into a final response.

Original Goal: ${plan.goal}
${autoCheckSummary}
${semanticSummary}

Sub-Task Results:
${JSON.stringify(results, null, 2)}

Please provide a final, coherent answer or output that achieves the original goal, based solely on the sub-task results.
If any sub-tasks failed, attempt to work around the failure or mention what is missing.
If the automatic checks or semantic review found issues, mention them in your synthesis.`;

    const response = await askLLM(systemPrompt, [{ role: 'user', content: 'Please synthesize the results.' }]);

    const contentText = response.content.find(block => block.type === 'text');
    if (!contentText || contentText.type !== 'text') {
      throw new Error("Failed to get text response from LLM");
    }

    // 附加验证报告（如果执行了验证）
    const duration = Date.now() - startTime;
    if (autoCheckResult) {
      const summary = generateSummary(autoCheckResult, semanticIssues, duration);
      return `${contentText.text}\n\n---\n${summary}`;
    }

    return contentText.text;
  }
}
