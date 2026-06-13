import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { getGovernanceSnapshot, applyGovernanceAction } from '../src/core/governance';
import { SkillRegistry } from '../src/core/skills';
import { RuleStore } from '../src/core/rules';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('getGovernanceSnapshot', () => {
  it('returns skill views with computed win rate and surfaces drafts first', () => {
    const reg = new SkillRegistry(tmpDir);
    const active = reg.createSkill('active-skill', 'an active one', ['py'], 'guidance');
    reg.recordOutcome(active.id, true);
    reg.recordOutcome(active.id, false);
    reg.createSkill('draft-skill', 'a draft', ['js'], 'guidance', { status: 'draft', source: 'auto-draft' });

    const snap = getGovernanceSnapshot(tmpDir);
    expect(snap.skills).toHaveLength(2);
    expect(snap.skills[0]!.status).toBe('draft'); // draft surfaced first
    const activeView = snap.skills.find(s => s.name === 'active-skill')!;
    expect(activeView.winRate).toBe(50);
    expect(activeView.uses).toBe(2);
  });

  it('reports null win rate when a skill has no uses', () => {
    new SkillRegistry(tmpDir).createSkill('fresh', 'no uses', ['x'], 'g');
    expect(getGovernanceSnapshot(tmpDir).skills[0]!.winRate).toBeNull();
  });

  it('lists active and pending_retirement rules but hides archived, pending first', () => {
    const store = new RuleStore(tmpDir, { retirementThreshold: 1 });
    store.addRule('keep me general'); // 无域 → 始终 active
    store.addRule('python specific rule', ['python']);
    store.onWorkflowCompleted(['other'], true); // python 规则未验证 → pending_retirement

    const archived = store.addRule('doomed', ['x']);
    store.archiveRule(archived.id);

    const snap = getGovernanceSnapshot(tmpDir);
    const texts = snap.rules.map(r => r.text);
    expect(texts).toContain('keep me general');
    expect(texts).toContain('python specific rule');
    expect(texts).not.toContain('doomed'); // archived 被过滤
    expect(snap.rules[0]!.status).toBe('pending_retirement'); // 待退役排最前
  });

  it('returns empty arrays for an untouched project', () => {
    expect(getGovernanceSnapshot(tmpDir)).toEqual({ skills: [], rules: [] });
  });
});

describe('applyGovernanceAction', () => {
  it('activates a draft skill', () => {
    const reg = new SkillRegistry(tmpDir);
    const draft = reg.createSkill('d', 'draft', ['k1', 'k2'], 'g', { status: 'draft' });

    expect(applyGovernanceAction({ kind: 'skill.activate', id: draft.id }, tmpDir)).toBe(true);
    expect(new SkillRegistry(tmpDir).loadSkill(draft.id)!.status).toBe('active');
  });

  it('retires an active skill without resetting its counters', () => {
    const reg = new SkillRegistry(tmpDir);
    const s = reg.createSkill('s', 'active', ['k'], 'g');
    reg.recordOutcome(s.id, true);

    expect(applyGovernanceAction({ kind: 'skill.retire', id: s.id }, tmpDir)).toBe(true);
    const reloaded = new SkillRegistry(tmpDir).loadSkill(s.id)!;
    expect(reloaded.status).toBe('retired');
    expect(reloaded.uses).toBe(1);
    expect(reloaded.wins).toBe(1);
  });

  it('archives and revives rules', () => {
    const store = new RuleStore(tmpDir);
    const r = store.addRule('a rule', ['d']);

    expect(applyGovernanceAction({ kind: 'rule.archive', id: r.id }, tmpDir)).toBe(true);
    expect(new RuleStore(tmpDir).getAll().find(x => x.id === r.id)!.status).toBe('archived');

    expect(applyGovernanceAction({ kind: 'rule.revive', id: r.id }, tmpDir)).toBe(true);
    expect(new RuleStore(tmpDir).getActive().some(x => x.id === r.id)).toBe(true);
  });

  it('returns false for a missing target', () => {
    expect(applyGovernanceAction({ kind: 'skill.activate', id: 'nope' }, tmpDir)).toBe(false);
    expect(applyGovernanceAction({ kind: 'rule.archive', id: 'nope' }, tmpDir)).toBe(false);
  });
});
