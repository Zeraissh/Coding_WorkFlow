/**
 * Governance — 进化闭环的人工治理层（Dashboard 后端逻辑）
 *
 * 进化闭环会自动起草 skill、提议退役规则，但这些都需要人来拍板：
 * 激活草稿、退役低胜率 skill、归档/保留待退役规则。本模块把这些动作
 * 抽成纯逻辑（不依赖 express），供 server 的 REST 端点调用，也便于单测。
 */

import { SkillRegistry } from './skills';
import { RuleStore } from './rules';

export interface SkillView {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'retired';
  source: 'manual' | 'auto-draft';
  triggerKeywords: string[];
  uses: number;
  wins: number;
  winRate: number | null; // null = 样本不足
}

export interface RuleView {
  id: string;
  text: string;
  domains: string[];
  status: 'active' | 'pending_retirement' | 'archived';
  hitCount: number;
}

export interface GovernanceSnapshot {
  skills: SkillView[];
  rules: RuleView[];
}

function rankSkill(s: SkillView['status']): number {
  return s === 'draft' ? 0 : s === 'active' ? 1 : 2;
}
function rankRule(s: RuleView['status']): number {
  return s === 'pending_retirement' ? 0 : s === 'active' ? 1 : 2;
}

/** 当前可治理的 skill / 规则快照（归档规则不展示，减少噪声） */
export function getGovernanceSnapshot(cwd: string = process.cwd()): GovernanceSnapshot {
  const skills: SkillView[] = new SkillRegistry(cwd).listSkills().map(s => ({
    id: s.id,
    name: s.name,
    description: s.description,
    status: s.status,
    source: s.source,
    triggerKeywords: s.triggerKeywords,
    uses: s.uses,
    wins: s.wins,
    winRate: s.uses > 0 ? Math.round((s.wins / s.uses) * 100) : null,
  }));

  const rules: RuleView[] = new RuleStore(cwd)
    .getAll()
    .filter(r => r.status !== 'archived')
    .map(r => ({
      id: r.id,
      text: r.text,
      domains: r.domains,
      status: r.status,
      hitCount: r.hitCount,
    }));

  // draft / pending_retirement 排在前面（需要人关注的）
  skills.sort((a, b) => rankSkill(a.status) - rankSkill(b.status));
  rules.sort((a, b) => rankRule(a.status) - rankRule(b.status));
  return { skills, rules };
}

export type GovernanceAction =
  | { kind: 'skill.activate'; id: string }
  | { kind: 'skill.retire'; id: string }
  | { kind: 'rule.archive'; id: string }
  | { kind: 'rule.revive'; id: string };

/** 执行一个治理动作，返回是否成功（目标不存在则 false） */
export function applyGovernanceAction(action: GovernanceAction, cwd: string = process.cwd()): boolean {
  switch (action.kind) {
    case 'skill.activate':
      return new SkillRegistry(cwd).activateSkill(action.id);
    case 'skill.retire':
      return new SkillRegistry(cwd).retireSkill(action.id);
    case 'rule.archive':
      return new RuleStore(cwd).archiveRule(action.id);
    case 'rule.revive':
      return new RuleStore(cwd).reviveRule(action.id);
    default:
      return false;
  }
}
