import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SkillRegistry, extractKeywords } from '../src/core/skills';
import { workflowEvents } from '../src/core/events';

let tmpDir: string;
let registry: SkillRegistry;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  registry = new SkillRegistry(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SkillRegistry — storage & matching', () => {
  it('persists skills as frontmatter markdown and round-trips', () => {
    const created = registry.createSkill(
      'serial-port-testing',
      '串口通信测试任务的领域经验',
      ['serial', 'port', '串口'],
      'Use com0com on Windows. Always close handles in teardown.'
    );
    const loaded = registry.loadSkill(created.id);
    expect(loaded).toMatchObject({
      name: 'serial-port-testing',
      status: 'active',
      triggerKeywords: ['serial', 'port', '串口'],
    });
    expect(loaded!.promptAddition).toContain('com0com');
  });

  it('matches a skill when enough trigger keywords hit', () => {
    registry.createSkill('serial-skill', '', ['serial', 'port', 'uart'], 'serial guidance');
    registry.createSkill('web-skill', '', ['react', 'frontend', 'css'], 'web guidance');

    const match = registry.matchSkill('Write a serial port reader for the device');
    expect(match?.name).toBe('serial-skill');
    expect(registry.matchSkill('Fix the database migration')).toBeNull();
  });

  it('does not match draft or retired skills', () => {
    registry.createSkill('draft-skill', '', ['serial', 'port'], 'x', { status: 'draft' });
    expect(registry.matchSkill('serial port task')).toBeNull();
  });

  it('prefers the skill with more keyword hits', () => {
    registry.createSkill('generic-python', '', ['python', 'script'], 'a');
    registry.createSkill('python-serial', '', ['python', 'script', 'serial'], 'b');
    const match = registry.matchSkill('write a python script for serial reading');
    expect(match?.name).toBe('python-serial');
  });
});

describe('SkillRegistry — win-rate lifecycle', () => {
  it('records outcomes and auto-retires low-win-rate skills with an event', () => {
    const events: any[] = [];
    const listener = (d: any) => events.push(d);
    workflowEvents.on('skillRetired', listener);

    try {
      const skill = registry.createSkill('flaky-skill', '', ['x', 'y'], 'z');
      // 1 胜 4 负 → 胜率 0.2 < 0.5，样本 5 → 退役
      registry.recordOutcome(skill.id, true);
      for (let i = 0; i < 4; i++) registry.recordOutcome(skill.id, false);

      const reloaded = registry.loadSkill(skill.id)!;
      expect(reloaded.status).toBe('retired');
      expect(reloaded.uses).toBe(5);
      expect(events).toHaveLength(1);
      expect(events[0].winRate).toBeCloseTo(0.2);
    } finally {
      workflowEvents.off('skillRetired', listener);
    }
  });

  it('keeps high-win-rate skills active and supports HITL reactivation', () => {
    const skill = registry.createSkill('good-skill', '', ['x', 'y'], 'z');
    for (let i = 0; i < 5; i++) registry.recordOutcome(skill.id, true);
    expect(registry.loadSkill(skill.id)!.status).toBe('active');

    // 手动退役后可复活
    const s = registry.loadSkill(skill.id)!;
    s.status = 'retired';
    registry.saveSkill(s);
    expect(registry.activateSkill(skill.id)).toBe(true);
    expect(registry.loadSkill(skill.id)!.status).toBe('active');
  });
});

describe('SkillRegistry — auto-drafting', () => {
  const draftResponse = '```json\n' + JSON.stringify({
    name: 'serial-bridge-tasks',
    description: 'Serial bridge implementation tasks',
    triggerKeywords: ['serial', 'bridge', 'uart'],
    promptAddition: 'Use pyserial. Mock ports with com0com on Windows.',
  }) + '\n```';

  it('drafts a skill after N similar successful goals (draft status + event)', async () => {
    const events: any[] = [];
    const listener = (d: any) => events.push(d);
    workflowEvents.on('skillDraftProposed', listener);

    try {
      const callLLM = vi.fn(async () => draftResponse);
      expect(await registry.considerDraft('build a serial bridge for device A', callLLM)).toBeNull();
      expect(await registry.considerDraft('add serial bridge support for device B', callLLM)).toBeNull();
      const draft = await registry.considerDraft('serial bridge retry logic for device C', callLLM);

      expect(draft).not.toBeNull();
      expect(draft!.status).toBe('draft');
      expect(draft!.source).toBe('auto-draft');
      expect(callLLM).toHaveBeenCalledTimes(1);
      expect(events).toHaveLength(1);
      expect(events[0].sampleGoals).toHaveLength(3);

      // 草稿不参与匹配，激活后才生效
      expect(registry.matchSkill('serial bridge task')).toBeNull();
      registry.activateSkill(draft!.id);
      expect(registry.matchSkill('serial bridge task')?.name).toBe('serial-bridge-tasks');
    } finally {
      workflowEvents.off('skillDraftProposed', listener);
    }
  });

  it('does not draft when an active skill already covers the goal', async () => {
    registry.createSkill('existing', '', ['serial', 'bridge'], 'covered');
    const callLLM = vi.fn(async () => draftResponse);
    for (let i = 0; i < 4; i++) {
      expect(await registry.considerDraft(`serial bridge variant ${i}`, callLLM)).toBeNull();
    }
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('does not draft from dissimilar goals', async () => {
    const callLLM = vi.fn(async () => draftResponse);
    expect(await registry.considerDraft('fix css layout', callLLM)).toBeNull();
    expect(await registry.considerDraft('optimize database index', callLLM)).toBeNull();
    expect(await registry.considerDraft('write rust parser', callLLM)).toBeNull();
    expect(callLLM).not.toHaveBeenCalled();
  });

  it('survives malformed LLM draft output', async () => {
    const callLLM = vi.fn(async () => 'not json at all');
    await registry.considerDraft('serial bridge one', callLLM);
    await registry.considerDraft('serial bridge two', callLLM);
    expect(await registry.considerDraft('serial bridge three', callLLM)).toBeNull();
  });
});

describe('extractKeywords', () => {
  it('extracts english words and chinese bigrams', () => {
    const kw = extractKeywords('开发串口 serial reader');
    expect(kw).toContain('serial');
    expect(kw).toContain('reader');
    expect(kw).toContain('串口');
  });
});
