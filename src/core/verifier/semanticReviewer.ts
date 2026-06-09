/**
 * SemanticReviewer — LLM 语义审查阶段
 *
 * 在 AutoChecker 完成后，使用便宜模型对代码进行语义层面的审查：
 * - 逻辑错误（自动检查查不出的语义问题）
 * - 代码风格是否统一
 * - 异常处理是否完整
 * - 是否有冗余代码
 * - 安全隐患
 *
 * 设计原则：
 * - 使用比 Orchestrator/Agent 更便宜的模型
 * - 只审查变更文件，不扫描整个代码库
 * - 输出结构化结果，可量化
 */

import type { SemanticIssue, AutoCheckResult, AgentExecutionLog, VerifierConfig } from './types';

// ============================================================================
// Dependencies
// ============================================================================

export interface SemanticReviewerDeps {
  /** LLM 调用（通常使用 haiku/flash 等便宜模型） */
  callLLM: (prompt: string, options?: { temperature?: number; maxTokens?: number }) => Promise<string>;
}

// ============================================================================
// Review Dimensions
// ============================================================================

interface ReviewDimension {
  name: string;
  prompt: string;
  category: SemanticIssue['category'];
}

const REVIEW_DIMENSIONS: ReviewDimension[] = [
  {
    name: '逻辑正确性',
    category: 'logic',
    prompt: '检查代码逻辑是否正确。关注：边界条件处理、空值检查、状态转换是否正确、是否存在死循环风险。',
  },
  {
    name: '异常处理',
    category: 'error_handling',
    prompt: '检查异常处理是否完整。关注：try-catch 覆盖、错误传播、fallback 机制、用户友好的错误消息。',
  },
  {
    name: '代码冗余',
    category: 'redundancy',
    prompt: '检查是否存在冗余代码。关注：重复逻辑、未使用的变量/导入、可以简化的复杂表达式、dead code。',
  },
  {
    name: '安全隐患',
    category: 'security',
    prompt: '检查安全隐患。关注：SQL注入、XSS、硬编码密钥、不安全的输入处理、权限检查缺失。',
  },
  {
    name: '风格一致性',
    category: 'style',
    prompt: '检查代码风格是否与项目保持一致。关注：命名规范、缩进、引号风格、文件组织方式是否统一。不同 Agent 生成的代码风格可能不同。',
  },
  {
    name: '性能问题',
    category: 'performance',
    prompt: '检查性能问题。关注：不必要的循环嵌套、大数据量下的内存使用、同步阻塞操作、缺少缓存、N+1 查询。',
  },
];

// ============================================================================
// SemanticReviewer
// ============================================================================

export class SemanticReviewer {
  private config: VerifierConfig;
  private deps: SemanticReviewerDeps;

  constructor(deps: SemanticReviewerDeps, config: VerifierConfig) {
    this.deps = deps;
    this.config = config;
  }

  // ==========================================================================
  // 公共 API
  // ==========================================================================

  /**
   * 执行语义审查
   *
   * @param agentLogs Agent 执行日志
   * @param autoCheckResult 第一阶段自动检查结果
   * @returns 语义问题列表
   */
  async review(
    agentLogs: AgentExecutionLog[],
    autoCheckResult?: AutoCheckResult
  ): Promise<SemanticIssue[]> {
    if (!this.config.semanticReview) {
      return [];
    }

    // 收集所有 Agent 生成的文件 diff
    const fileDiffs = this.collectFileDiffs(agentLogs);
    if (fileDiffs.length === 0) {
      return [];
    }

    // 构建审查 prompt
    const prompt = this.buildReviewPrompt(fileDiffs, autoCheckResult);

    // 调用 LLM（使用便宜模型）
    let rawResponse: string;
    try {
      rawResponse = await this.deps.callLLM(prompt, {
        temperature: 0.1,
        maxTokens: 4000,
      });
    } catch {
      // LLM 调用失败 → 返回空（语义审查非强制性）
      return [];
    }

    return this.parseReviewResponse(rawResponse);
  }

  // ==========================================================================
  // 私有方法
  // ==========================================================================

  private collectFileDiffs(agentLogs: AgentExecutionLog[]): { file: string; agentId: string; content: string }[] {
    const diffs: { file: string; agentId: string; content: string }[] = [];
    for (const log of agentLogs) {
      for (const op of log.files) {
        if (op.operation === 'write' && op.content) {
          // 截断过大的文件（每个文件最多 200 行）
          const lines = op.content.split('\n');
          const truncated = lines.length > 200
            ? lines.slice(0, 200).join('\n') + `\n... (${lines.length - 200} more lines)`
            : op.content;

          diffs.push({
            file: op.filePath,
            agentId: log.agentId,
            content: truncated,
          });
        }
      }
    }
    return diffs;
  }

  private buildReviewPrompt(
    diffs: { file: string; agentId: string; content: string }[],
    autoCheckResult?: AutoCheckResult
  ): string {
    const filesSection = diffs
      .map(
        (d) =>
          `### ${d.file} (由 ${d.agentId} 生成)\n\`\`\`\n${d.content}\n\`\`\``
      )
      .join('\n\n');

    const autoCheckSection = autoCheckResult
      ? `
## 第一阶段自动检查结果
- Lint 错误: ${autoCheckResult.lintErrors.length} 个
- 类型错误: ${autoCheckResult.typeErrors.length} 个
- 文件冲突: ${autoCheckResult.fileConflicts.length} 个
- 接口不匹配: ${autoCheckResult.interfaceMismatches.length} 个
${autoCheckResult.passed ? '- 自动检查: ✅ 全部通过' : '- 自动检查: ❌ 存在问题'}
`
      : '';

    const dimensionsSection = REVIEW_DIMENSIONS.map(
      (d) => `### ${d.name}\n${d.prompt}`
    ).join('\n\n');

    return `你是代码审查专家。以下是多 Agent 并行协作系统生成的代码文件，请从以下维度进行审查。

${autoCheckSection}

## 变更文件
${filesSection}

## 审查维度
${dimensionsSection}

## 输出格式
以 JSON 数组格式输出所有发现的问题:
\`\`\`json
[
  {
    "severity": "critical" | "warning" | "style",
    "file": "文件路径",
    "line": 行号(可选),
    "category": "logic" | "error_handling" | "redundancy" | "security" | "performance" | "style",
    "description": "问题描述",
    "suggestion": "修复建议"
  }
]
\`\`\`

没有发现问题则输出空数组: []
只输出 JSON，不要其他解释。`;
  }

  private parseReviewResponse(raw: string): SemanticIssue[] {
    // 提取 JSON 块
    const jsonMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const jsonStr = (jsonMatch?.[1] ?? raw).trim();

    try {
      const parsed = JSON.parse(jsonStr);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item: any): item is SemanticIssue =>
            typeof item === 'object' &&
            item !== null &&
            typeof item.file === 'string' &&
            typeof item.description === 'string'
        )
        .map((item: any) => ({
          severity: (['critical', 'warning', 'style'].includes(item.severity) ? item.severity : 'warning') as SemanticIssue['severity'],
          file: item.file,
          line: typeof item.line === 'number' ? item.line : undefined,
          category: (['logic', 'error_handling', 'redundancy', 'security', 'performance', 'style'].includes(item.category) ? item.category : 'logic') as SemanticIssue['category'],
          description: item.description,
          suggestion: item.suggestion || '',
        }));
    } catch {
      return [];
    }
  }
}

/**
 * 生成人类可读的验证汇总
 */
export function generateSummary(
  autoCheck: AutoCheckResult,
  semanticIssues: SemanticIssue[],
  durationMs: number
): string {
  const lines: string[] = [];

  lines.push('## 验证报告\n');
  lines.push(`⏱ 耗时: ${(durationMs / 1000).toFixed(1)}s\n`);

  // 自动检查汇总
  lines.push('### 第一阶段: 自动检查');
  const acItems: string[] = [];
  acItems.push(`- Lint: ${autoCheck.lintErrors.length} 个错误`);
  acItems.push(`- 类型检查: ${autoCheck.typeErrors.length} 个错误`);
  acItems.push(`- 文件冲突: ${autoCheck.fileConflicts.length} 个`);
  acItems.push(`- 接口不匹配: ${autoCheck.interfaceMismatches.length} 个`);
  acItems.push(`- 测试: ${autoCheck.testResults ? `${autoCheck.testResults.passed}P / ${autoCheck.testResults.failed}F` : '未运行'}`);
  acItems.push(`- 结果: ${autoCheck.passed ? '✅ 全部通过' : '❌ 存在问题'}`);
  lines.push(...acItems);

  // 语义审查汇总
  lines.push('\n### 第二阶段: 语义审查');
  if (semanticIssues.length === 0) {
    lines.push('✅ 未发现语义问题');
  } else {
    const critical = semanticIssues.filter((i) => i.severity === 'critical');
    const warnings = semanticIssues.filter((i) => i.severity === 'warning');
    const style = semanticIssues.filter((i) => i.severity === 'style');
    lines.push(`- 🔴 Critical: ${critical.length} 个`);
    lines.push(`- 🟠 Warning: ${warnings.length} 个`);
    lines.push(`- 🔵 Style: ${style.length} 个`);

    if (critical.length > 0) {
      lines.push('\n#### 严重问题');
      for (const issue of critical) {
        lines.push(`- **${issue.file}** (${issue.category}): ${issue.description}`);
        if (issue.suggestion) lines.push(`  → ${issue.suggestion}`);
      }
    }
  }

  // 最终判定
  lines.push('\n### 最终判定');
  const hasAutoFail = !autoCheck.passed;
  const hasCriticalSemantic = semanticIssues.some((i) => i.severity === 'critical');
  const hasWarnings = semanticIssues.some((i) => i.severity === 'warning');

  if (hasAutoFail || hasCriticalSemantic) {
    lines.push('🔴 **FAIL** — 存在必须修复的问题');
  } else if (hasWarnings) {
    lines.push('🟡 **PASS WITH WARNINGS** — 建议检查警告');
  } else {
    lines.push('🟢 **PASS** — 所有检查通过');
  }

  return lines.join('\n');
}
