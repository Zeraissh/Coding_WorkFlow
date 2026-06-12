import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { RuleStore } from '../src/core/rules';
import { workflowEvents } from '../src/core/events';

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rules-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('RuleStore — add & dedup', () => {
  it('adds rules and renders them to project_rules.md', () => {
    const store = new RuleStore(tmpDir);
    store.addRule('Always run tests before committing', ['testing']);
    store.addRule('Use PowerShell syntax on Windows', ['windows', 'shell']);

    expect(store.getActive()).toHaveLength(2);
    const md = fs.readFileSync(path.join(tmpDir, '.workflow', 'project_rules.md'), 'utf-8');
    expect(md).toContain('Always run tests before committing');
    expect(md).toContain('[windows, shell]');
  });

  it('deduplicates semantically identical text instead of appending', () => {
    const store = new RuleStore(tmpDir);
    store.addRule('Always run tests before committing.', ['testing']);
    const merged = store.addRule('always run tests   before committing', ['ci']);

    expect(store.getActive()).toHaveLength(1);
    expect(merged.domains.sort()).toEqual(['ci', 'testing']); // 标签合并
  });

  it('migrates legacy project_rules.md bullets on first load', () => {
    const dir = path.join(tmpDir, '.workflow');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project_rules.md'), '- legacy rule one\n- legacy rule two\n', 'utf-8');

    const store = new RuleStore(tmpDir);
    expect(store.getActive().map(r => r.text)).toEqual(['legacy rule one', 'legacy rule two']);
    expect(fs.existsSync(path.join(dir, 'rules.json'))).toBe(true);
  });
});

describe('RuleStore — scoped retrieval (C.3)', () => {
  it('returns untagged rules always and tagged rules only on domain match', () => {
    const store = new RuleStore(tmpDir);
    store.addRule('universal rule');
    store.addRule('pytest must run with -x', ['python']);
    store.addRule('use git rebase carefully', ['git']);

    const rules = store.getRulesForTask('Write a python script that parses logs');
    expect(rules.map(r => r.text)).toContain('universal rule');
    expect(rules.map(r => r.text)).toContain('pytest must run with -x');
    expect(rules.map(r => r.text)).not.toContain('use git rebase carefully');
  });

  it('increments hitCount on injection and respects maxInjectedRules', () => {
    const store = new RuleStore(tmpDir, { maxInjectedRules: 2 });
    store.addRule('rule a');
    store.addRule('rule b');
    store.addRule('rule c');

    const rules = store.getRulesForTask('any task');
    expect(rules).toHaveLength(2);

    const reloaded = new RuleStore(tmpDir);
    expect(reloaded.getAll().filter(r => r.hitCount > 0)).toHaveLength(2);
  });
});

describe('RuleStore — lifecycle & retirement', () => {
  it('moves stale rules to pending_retirement and emits an event', () => {
    const events: any[] = [];
    const listener = (d: any) => events.push(d);
    workflowEvents.on('ruleRetirementProposed', listener);

    try {
      const store = new RuleStore(tmpDir, { retirementThreshold: 3 });
      store.addRule('stale python rule', ['python']);
      store.addRule('fresh git rule', ['git']);

      // 3 个 git 域的成功工作流：python 规则未被验证
      for (let i = 0; i < 3; i++) {
        store.onWorkflowCompleted(['git'], true);
      }

      const all = store.getAll();
      expect(all.find(r => r.text === 'stale python rule')!.status).toBe('pending_retirement');
      expect(all.find(r => r.text === 'fresh git rule')!.status).toBe('active');
      expect(events).toHaveLength(1);
      expect(events[0].rules[0].text).toBe('stale python rule');
    } finally {
      workflowEvents.off('ruleRetirementProposed', listener);
    }
  });

  it('pending rules are excluded from injection but revive on re-validation', () => {
    const store = new RuleStore(tmpDir, { retirementThreshold: 1 });
    store.addRule('python rule', ['python']);
    store.onWorkflowCompleted(['git'], true); // → pending_retirement

    expect(store.getRulesForTask('a python task')).toHaveLength(0);

    store.onWorkflowCompleted(['python'], true); // 相关域成功 → 复活
    expect(store.getRulesForTask('a python task')).toHaveLength(1);
  });

  it('failed workflows do not validate rules', () => {
    const store = new RuleStore(tmpDir, { retirementThreshold: 2 });
    store.addRule('some rule', ['python']);
    store.onWorkflowCompleted(['python'], false);
    store.onWorkflowCompleted(['python'], false);
    expect(store.getAll()[0]!.status).toBe('pending_retirement');
  });

  it('archive and revive via HITL APIs', () => {
    const store = new RuleStore(tmpDir);
    const rule = store.addRule('candidate', ['x']);
    expect(store.archiveRule(rule.id)).toBe(true);
    expect(store.getActive()).toHaveLength(0);

    expect(store.reviveRule(rule.id)).toBe(true);
    expect(store.getActive()).toHaveLength(1);
    expect(store.archiveRule('nonexistent')).toBe(false);
  });

  it('re-adding an archived rule revives it (dedup path)', () => {
    const store = new RuleStore(tmpDir, { retirementThreshold: 1 });
    const rule = store.addRule('comeback rule', ['x']);
    store.onWorkflowCompleted(['other'], true);
    expect(store.getAll()[0]!.status).toBe('pending_retirement');

    store.addRule('comeback rule');
    expect(store.getAll()[0]!.status).toBe('active');
    expect(store.getAll()).toHaveLength(1);
    expect(rule.id).toBe(store.getAll()[0]!.id);
  });
});
