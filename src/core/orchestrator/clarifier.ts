/**
 * Clarifier — 需求澄清阶段
 *
 * 解决"描述一句话、场景一座山"的问题（如"开发一款扫地机器人"实际涉及
 * 固件/下位机/上位机/通信协议多层架构）：
 *
 * 1. 缺口评估：LLM 判断目标的复杂度、模糊度与缺失维度，低复杂度任务直接跳过
 * 2. 调研增强：用 search_web 检索同类成熟产品与高星开源项目，转化为选项依据
 * 3. 选项式提问：每题 2-4 个带推荐项的选项（CLI select / Dashboard 问卷 / auto 模式）
 * 4. 产出需求规格（PRD-lite）：固化为 .workflow/requirements.md，作为分解契约
 */

import * as fs from 'fs';
import * as path from 'path';
import { z } from 'zod';

// ============================================================================
// Schemas
// ============================================================================

export const GapAssessmentSchema = z.object({
  complexityEstimate: z.coerce.number().catch(5).default(5),
  ambiguityScore: z.coerce.number().catch(0).default(0), // 0-1
  missingDimensions: z.array(z.coerce.string()).catch([]).default([]),
  multiLayer: z.coerce.boolean().catch(false).default(false), // 跨硬件/前后端等多层架构
});
export type GapAssessment = z.infer<typeof GapAssessmentSchema>;

export const ClarifyOptionSchema = z.object({
  label: z.coerce.string().min(1),
  rationale: z.coerce.string().catch('').default(''), // 业界这么选的理由 + 参考项目
  recommended: z.coerce.boolean().catch(false).default(false),
});

export const ClarifyQuestionSchema = z.object({
  id: z.coerce.string().min(1),
  question: z.coerce.string().min(1),
  options: z.array(ClarifyOptionSchema).min(2).max(4),
});
export type ClarifyQuestion = z.infer<typeof ClarifyQuestionSchema>;

export interface ClarifyAnswer {
  questionId: string;
  choice: string;
  /** auto 模式下采用推荐项时为 true，写入需求规格的"假设"一节 */
  assumed: boolean;
}

export interface ClarifierConfig {
  enabled: boolean;
  /** 自动采用推荐项，不阻塞等待用户（无人值守场景） */
  auto: boolean;
  /** 触发澄清的复杂度阈值 */
  complexityThreshold: number;
  maxQuestions: number;
  /** 是否启用外部调研（无网络环境关掉） */
  enableResearch: boolean;
}

export const DEFAULT_CLARIFIER_CONFIG: ClarifierConfig = {
  enabled: true,
  auto: false,
  complexityThreshold: 7,
  maxQuestions: 4,
  enableResearch: true,
};

export interface ClarifierDeps {
  callLLM: (prompt: string, opts?: { temperature?: number; maxTokens?: number }) => Promise<string>;
  /** 外部调研（通常注入 search_web 工具）；失败/缺省时降级为纯 LLM 知识出题 */
  searchWeb?: (query: string) => Promise<string>;
}

// ============================================================================
// Clarifier
// ============================================================================

function extractJson(raw: string): unknown {
  const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  const jsonStr = (match?.[1] ?? raw).trim();
  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

export class Clarifier {
  private config: ClarifierConfig;
  private deps: ClarifierDeps;

  constructor(deps: ClarifierDeps, config?: Partial<ClarifierConfig>) {
    this.deps = deps;
    this.config = { ...DEFAULT_CLARIFIER_CONFIG, ...config };
  }

  /** Step 1: 缺口评估 */
  async assessGaps(goal: string): Promise<GapAssessment> {
    const prompt = `You are a requirements analyst. Assess the following user goal for information gaps BEFORE任务分解.

User goal: "${goal}"

Evaluate:
- complexityEstimate (1-10): overall engineering complexity of the REAL scope implied by the goal
- ambiguityScore (0-1): how much critical information is missing from the description
- missingDimensions: list of unstated but decision-critical dimensions (e.g. "MCU platform", "通信协议", "仿真还是实机", "范围边界")
- multiLayer: true if the goal spans multiple architectural layers (硬件+固件+上位机, 前端+后端+部署, etc.)

Return ONLY a JSON object in a \`\`\`json block with keys: complexityEstimate, ambiguityScore, missingDimensions, multiLayer.`;

    const raw = await this.deps.callLLM(prompt, { temperature: 0.1, maxTokens: 800 });
    const parsed = GapAssessmentSchema.safeParse(extractJson(raw));
    return parsed.success
      ? parsed.data
      : { complexityEstimate: 5, ambiguityScore: 0, missingDimensions: [], multiLayer: false };
  }

  /** 是否需要进入澄清：高复杂度 + (高模糊度 | 多缺失维度 | 跨层架构) */
  needsClarification(assessment: GapAssessment): boolean {
    if (!this.config.enabled) return false;
    if (assessment.complexityEstimate < this.config.complexityThreshold) return false;
    return assessment.ambiguityScore >= 0.5
      || assessment.missingDimensions.length >= 2
      || assessment.multiLayer;
  }

  /** Step 2: 调研（尽力而为，失败静默降级） */
  private async research(goal: string): Promise<string> {
    if (!this.config.enableResearch || !this.deps.searchWeb) return '';
    const queries = [
      `${goal} open source github`,
      `${goal} architecture best practices`,
    ];
    const notes: string[] = [];
    for (const q of queries) {
      try {
        const result = await this.deps.searchWeb(q);
        if (result) notes.push(`### Query: ${q}\n${result.slice(0, 1500)}`);
      } catch {
        // 无网络/被限流 → 降级为纯 LLM 知识
      }
    }
    return notes.join('\n\n');
  }

  /** Step 3: 生成选项式问题 */
  async generateQuestions(goal: string, assessment: GapAssessment): Promise<{ questions: ClarifyQuestion[]; researchNotes: string }> {
    const researchNotes = await this.research(goal);

    const prompt = `You are a senior product engineer helping clarify an under-specified goal before implementation.

User goal: "${goal}"
Missing dimensions identified: ${assessment.missingDimensions.join(', ') || 'unknown'}

${researchNotes ? `Market/open-source research findings:\n${researchNotes}\n` : ''}
Generate AT MOST ${this.config.maxQuestions} multiple-choice questions covering the most decision-critical gaps.
Rules:
- Each question has 2-4 options
- Each option's "rationale" must explain WHY the industry chooses it, citing reference products/open-source projects when possible (e.g. Valetudo, ESPHome, ROS)
- Mark exactly ONE option per question as "recommended": true (the sensible default)
- Questions must be answerable by a non-expert picking an option

Return ONLY a JSON array in a \`\`\`json block, each item: { "id": "...", "question": "...", "options": [{ "label": "...", "rationale": "...", "recommended": true|false }] }.`;

    const raw = await this.deps.callLLM(prompt, { temperature: 0.3, maxTokens: 2500 });
    const json = extractJson(raw);
    if (!Array.isArray(json)) return { questions: [], researchNotes };

    const questions = json
      .map(item => {
        const parsed = ClarifyQuestionSchema.safeParse(item);
        return parsed.success ? parsed.data : null;
      })
      .filter((q): q is ClarifyQuestion => q !== null)
      .slice(0, this.config.maxQuestions);

    return { questions, researchNotes };
  }

  /** auto 模式：每题采用推荐项（无推荐项取第一项），全部标记为假设 */
  autoAnswer(questions: ClarifyQuestion[]): ClarifyAnswer[] {
    return questions.map(q => {
      const rec = q.options.find(o => o.recommended) ?? q.options[0]!;
      return { questionId: q.id, choice: rec.label, assumed: true };
    });
  }

  /** Step 4: 产出需求规格（PRD-lite）并落盘 */
  buildRequirementsDoc(
    goal: string,
    questions: ClarifyQuestion[],
    answers: ClarifyAnswer[],
    researchNotes: string
  ): string {
    const answerMap = new Map(answers.map(a => [a.questionId, a]));
    const lines: string[] = [
      `# 需求规格（自动生成）`,
      ``,
      `> 由 Clarify Phase 生成于 ${new Date().toISOString()}。本文件是任务分解与验收的契约。`,
      ``,
      `## 原始目标`,
      ``,
      goal,
      ``,
      `## 架构/范围决策`,
      ``,
      `| 决策点 | 选择 | 依据 | 来源 |`,
      `|---|---|---|---|`,
    ];

    for (const q of questions) {
      const a = answerMap.get(q.id);
      if (!a) continue;
      const opt = q.options.find(o => o.label === a.choice);
      lines.push(`| ${q.question} | ${a.choice} | ${opt?.rationale || '-'} | ${a.assumed ? '推荐项（假设）' : '用户确认'} |`);
    }

    const assumptions = answers.filter(a => a.assumed);
    if (assumptions.length > 0) {
      lines.push(``, `## 未经确认的假设`, ``,
        `以下决策采用了系统推荐项而非用户确认，验收时需重点复核：`, ``);
      for (const a of assumptions) {
        const q = questions.find(qq => qq.id === a.questionId);
        lines.push(`- ${q?.question ?? a.questionId} → **${a.choice}**`);
      }
    }

    if (researchNotes) {
      lines.push(``, `## 调研引用`, ``, researchNotes);
    }

    return lines.join('\n');
  }

  saveRequirementsDoc(content: string, cwd: string = process.cwd()): string {
    const dir = path.join(cwd, '.workflow');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, 'requirements.md');
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, content, 'utf-8');
    fs.renameSync(tmpPath, filePath);
    return filePath;
  }
}
