/**
 * SkillRegistry — Skill 注册表（P2.5-A.3）
 *
 * Skill = 针对某类任务沉淀的领域上下文包（专用提示词 + 验收标准 + 触发关键词）。
 * 与 TemplateManager（显式 "Template:xxx" 调用的整套计划模板）互补：
 * skill 由关键词自动匹配，只注入上下文，不接管分解。
 *
 * 生命周期闭环：
 * - 匹配即用：记录 uses；工作流结束按成败记录 wins → 胜率
 * - 自动退役：样本 ≥ minSamples 且胜率 < retireWinRate → retired（skillRetired 事件）
 * - 自动起草：连续 ≥3 个相似的成功目标且无现有 skill 覆盖 → LLM 起草草稿
 *   （status: draft，需 HITL activateSkill 激活，绝不静默上线）
 *
 * 存储：.workflow/skills/<id>.md，JSON frontmatter + 正文（promptAddition），
 * 对齐社区 SKILL.md 习惯，可直接人工编辑。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { workflowEvents } from './events';

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  /** 触发关键词（小写）；匹配 ≥ minKeywordHits 个才命中 */
  triggerKeywords: string[];
  status: 'draft' | 'active' | 'retired';
  uses: number;
  wins: number;
  createdAt: number;
  source: 'manual' | 'auto-draft';
}

export interface Skill extends SkillMeta {
  /** 注入分解/执行上下文的领域提示词 */
  promptAddition: string;
}

export interface SkillRegistryConfig {
  /** 命中多少个触发关键词才算匹配 */
  minKeywordHits: number;
  /** 自动退役所需的最小样本量 */
  minSamplesForRetire: number;
  /** 低于该胜率自动退役 */
  retireWinRate: number;
  /** 多少个相似成功目标触发起草 */
  draftAfterSimilarSuccesses: number;
}

const DEFAULT_CONFIG: SkillRegistryConfig = {
  minKeywordHits: 2,
  minSamplesForRetire: 5,
  retireWinRate: 0.5,
  draftAfterSimilarSuccesses: 3,
};

/** 中英文混合关键词抽取（与 knowledge.ts 同策略） */
export function extractKeywords(text: string): string[] {
  const tokens = new Set<string>();
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
  for (const w of words) {
    if (w.length >= 3) tokens.add(w);
  }
  const cjk = text.match(/[一-鿿]+/g) || [];
  for (const segment of cjk) {
    for (let i = 0; i < segment.length - 1; i++) {
      tokens.add(segment.slice(i, i + 2));
    }
  }
  return [...tokens];
}

export class SkillRegistry {
  private dir: string;
  private historyFile: string;
  private config: SkillRegistryConfig;

  constructor(cwd: string = process.cwd(), config?: Partial<SkillRegistryConfig>) {
    this.dir = path.join(cwd, '.workflow', 'skills');
    this.historyFile = path.join(this.dir, '_history.json');
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  private skillPath(id: string): string {
    return path.join(this.dir, `${id}.md`);
  }

  // ==========================================================================
  // 存储
  // ==========================================================================

  saveSkill(skill: Skill): void {
    this.ensureDir();
    const { promptAddition, ...meta } = skill;
    const content = ['---', JSON.stringify(meta, null, 2), '---', promptAddition].join('\n');
    const filePath = this.skillPath(skill.id);
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, filePath);
  }

  loadSkill(id: string): Skill | null {
    const filePath = this.skillPath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return null;
      const meta = JSON.parse(match[1]!) as SkillMeta;
      return { ...meta, promptAddition: match[2]!.trim() };
    } catch {
      return null;
    }
  }

  listSkills(): Skill[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.md') && !f.startsWith('_'))
      .map(f => this.loadSkill(f.replace(/\.md$/, '')))
      .filter((s): s is Skill => s !== null);
  }

  /** 新建 skill（手工或起草） */
  createSkill(
    name: string,
    description: string,
    triggerKeywords: string[],
    promptAddition: string,
    opts: { status?: SkillMeta['status']; source?: SkillMeta['source'] } = {}
  ): Skill {
    const id = crypto.createHash('sha1').update(name).digest('hex').slice(0, 10);
    const skill: Skill = {
      id,
      name,
      description,
      triggerKeywords: triggerKeywords.map(k => k.toLowerCase()),
      status: opts.status ?? 'active',
      uses: 0,
      wins: 0,
      createdAt: Date.now(),
      source: opts.source ?? 'manual',
      promptAddition,
    };
    this.saveSkill(skill);
    return skill;
  }

  // ==========================================================================
  // 匹配与胜率闭环
  // ==========================================================================

  /** 关键词匹配：返回命中数最高的 active skill（不足 minKeywordHits 不命中） */
  matchSkill(text: string): Skill | null {
    const textKeywords = new Set(extractKeywords(text));
    let best: { skill: Skill; hits: number } | null = null;

    for (const skill of this.listSkills()) {
      if (skill.status !== 'active') continue;
      const hits = skill.triggerKeywords.filter(k => textKeywords.has(k)).length;
      const required = Math.min(this.config.minKeywordHits, skill.triggerKeywords.length);
      if (hits >= required && (!best || hits > best.hits)) {
        best = { skill, hits };
      }
    }
    return best?.skill ?? null;
  }

  /** 工作流结束回写胜负；样本足够且胜率过低自动退役 */
  recordOutcome(skillId: string, success: boolean): void {
    const skill = this.loadSkill(skillId);
    if (!skill) return;
    skill.uses++;
    if (success) skill.wins++;

    if (
      skill.status === 'active' &&
      skill.uses >= this.config.minSamplesForRetire &&
      skill.wins / skill.uses < this.config.retireWinRate
    ) {
      skill.status = 'retired';
      workflowEvents.emit('skillRetired', {
        skillId: skill.id,
        name: skill.name,
        winRate: skill.wins / skill.uses,
        uses: skill.uses,
      });
    }
    this.saveSkill(skill);
  }

  /** HITL：激活草稿 / 复活退役 skill */
  activateSkill(id: string): boolean {
    const skill = this.loadSkill(id);
    if (!skill) return false;
    skill.status = 'active';
    this.saveSkill(skill);
    return true;
  }

  // ==========================================================================
  // 自动起草
  // ==========================================================================

  private loadHistory(): string[] {
    if (!fs.existsSync(this.historyFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(this.historyFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  private saveHistory(history: string[]): void {
    this.ensureDir();
    const tmp = `${this.historyFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(history.slice(-50), null, 2), 'utf-8');
    fs.renameSync(tmp, this.historyFile);
  }

  /**
   * 成功工作流后调用：记录目标，检测"≥N 个相似历史目标且无 skill 覆盖"，
   * 满足则用 LLM 起草 skill 草稿（draft 状态，等 HITL 激活）。
   * @returns 新起草的 skill（未触发时返回 null）
   */
  async considerDraft(
    goal: string,
    callLLM: (prompt: string) => Promise<string>
  ): Promise<Skill | null> {
    const history = this.loadHistory();
    history.push(goal);
    this.saveHistory(history);

    // 已有 skill 覆盖该目标 → 不起草
    if (this.matchSkill(goal)) return null;

    // 找与当前目标共享 ≥2 个关键词的历史成功目标
    const goalKeywords = new Set(extractKeywords(goal));
    const similar = history.slice(0, -1).filter(g => {
      const shared = extractKeywords(g).filter(k => goalKeywords.has(k)).length;
      return shared >= 2;
    });

    if (similar.length + 1 < this.config.draftAfterSimilarSuccesses) return null;

    const samples = [...similar.slice(-4), goal];
    const prompt = `You are a skill-library curator for a coding agent. The agent has repeatedly succeeded at similar goals:

${samples.map((g, i) => `${i + 1}. ${g}`).join('\n')}

Draft a reusable SKILL that captures the domain context for this category of task.
Return ONLY a JSON object in a \`\`\`json block:
{
  "name": "short-kebab-case-name",
  "description": "one-line summary of when this skill applies",
  "triggerKeywords": ["3-6 lowercase keywords that identify this task category"],
  "promptAddition": "Domain guidance injected into the agent's context: key conventions, pitfalls, recommended approach. Be specific and actionable, max 200 words."
}`;

    try {
      const raw = await callLLM(prompt);
      const match = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      const parsed = JSON.parse((match?.[1] ?? raw).trim());
      if (!parsed?.name || !parsed?.promptAddition || !Array.isArray(parsed?.triggerKeywords)) {
        return null;
      }

      const skill = this.createSkill(
        String(parsed.name),
        String(parsed.description || ''),
        parsed.triggerKeywords.map(String),
        String(parsed.promptAddition),
        { status: 'draft', source: 'auto-draft' }
      );
      workflowEvents.emit('skillDraftProposed', {
        skillId: skill.id,
        name: skill.name,
        description: skill.description,
        sampleGoals: samples,
      });
      return skill;
    } catch {
      return null;
    }
  }
}
