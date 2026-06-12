/**
 * RuleStore — 项目规则生命周期管理（P2.5-A.2）
 *
 * 替代 append-only 的 project_rules.md：
 * - 结构化存储 .workflow/rules.json：每条规则带 id/域标签/命中计数/最近验证时间/状态
 * - 去重：新教训与既有规则文本重合时合并而非追加，遏制提示词膨胀
 * - 退役：连续多个工作流未被相关域命中的规则进入"待退役"，发事件供 HITL 确认归档
 * - 兼容：每次变更后渲染回 project_rules.md，getProjectMemory() 等旧读取方不受影响
 * - 作用域查询（供 C.3）：按任务描述匹配域标签，只返回相关规则子集
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { workflowEvents } from './events';

export interface Rule {
  id: string;
  text: string;
  /** 域标签，如 ['python', 'testing']；空数组 = 通用规则（始终注入） */
  domains: string[];
  sourceWorkflowId?: string;
  createdAt: number;
  /** 最近一次相关域工作流成功完成的时间 */
  lastValidatedAt: number;
  /** 被注入 Agent 上下文的次数 */
  hitCount: number;
  /** 自最近验证以来经过的工作流数 */
  workflowsSinceValidation: number;
  status: 'active' | 'pending_retirement' | 'archived';
}

export interface RuleStoreConfig {
  /** 连续多少个工作流未验证后进入待退役 */
  retirementThreshold: number;
  /** 注入时通用规则 + 域匹配规则的总数上限 */
  maxInjectedRules: number;
}

const DEFAULT_CONFIG: RuleStoreConfig = {
  retirementThreshold: 10,
  maxInjectedRules: 12,
};

function ruleId(text: string): string {
  return crypto.createHash('sha1').update(text.trim()).digest('hex').slice(0, 10);
}

/** 简化文本用于去重比较（去标点/空白/大小写） */
function normalizeForDedup(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export class RuleStore {
  private rulesFile: string;
  private renderedFile: string;
  private config: RuleStoreConfig;
  private rules: Rule[] = [];

  constructor(cwd: string = process.cwd(), config?: Partial<RuleStoreConfig>) {
    const dir = path.join(cwd, '.workflow');
    this.rulesFile = path.join(dir, 'rules.json');
    this.renderedFile = path.join(dir, 'project_rules.md');
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.load();
  }

  private load(): void {
    if (fs.existsSync(this.rulesFile)) {
      try {
        this.rules = JSON.parse(fs.readFileSync(this.rulesFile, 'utf-8'));
        return;
      } catch {
        this.rules = [];
      }
    }
    // 迁移：旧 project_rules.md 存在但 rules.json 不存在 → 导入为无标签规则
    if (fs.existsSync(this.renderedFile)) {
      const lines = fs.readFileSync(this.renderedFile, 'utf-8').split('\n');
      const now = Date.now();
      for (const line of lines) {
        const text = line.replace(/^[-*]\s*/, '').trim();
        if (text.length > 0 && !text.startsWith('#')) {
          this.rules.push({
            id: ruleId(text),
            text,
            domains: [],
            createdAt: now,
            lastValidatedAt: now,
            hitCount: 0,
            workflowsSinceValidation: 0,
            status: 'active',
          });
        }
      }
      if (this.rules.length > 0) this.save();
    }
  }

  private save(): void {
    const dir = path.dirname(this.rulesFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = `${this.rulesFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.rules, null, 2), 'utf-8');
    fs.renameSync(tmp, this.rulesFile);
    this.render();
  }

  /** 渲染人类可读 md（旧读取方 getProjectMemory 的兼容层） */
  private render(): void {
    const active = this.rules.filter(r => r.status === 'active');
    const lines: string[] = ['# Project Rules (managed by RuleStore — edit rules.json, not this file)', ''];
    for (const r of active) {
      const tag = r.domains.length > 0 ? ` _[${r.domains.join(', ')}]_` : '';
      lines.push(`- ${r.text}${tag}`);
    }
    const tmp = `${this.renderedFile}.tmp`;
    fs.writeFileSync(tmp, lines.join('\n'), 'utf-8');
    fs.renameSync(tmp, this.renderedFile);
  }

  getAll(): Rule[] {
    return [...this.rules];
  }

  getActive(): Rule[] {
    return this.rules.filter(r => r.status === 'active');
  }

  /**
   * 新增规则（带去重）：文本归一化后与既有规则重合 → 刷新验证时间而非追加。
   * @returns 实际生效的规则（新建或已存在的）
   */
  addRule(text: string, domains: string[] = [], sourceWorkflowId?: string): Rule {
    const normalized = normalizeForDedup(text);
    const existing = this.rules.find(r => normalizeForDedup(r.text) === normalized && r.status !== 'archived');
    if (existing) {
      existing.lastValidatedAt = Date.now();
      existing.workflowsSinceValidation = 0;
      existing.status = 'active'; // 重新被提出 → 复活待退役规则
      // 合并新标签
      for (const d of domains) {
        if (!existing.domains.includes(d)) existing.domains.push(d);
      }
      this.save();
      return existing;
    }

    const rule: Rule = {
      id: ruleId(text),
      text: text.trim(),
      domains,
      createdAt: Date.now(),
      lastValidatedAt: Date.now(),
      hitCount: 0,
      workflowsSinceValidation: 0,
      status: 'active',
    };
    if (sourceWorkflowId) rule.sourceWorkflowId = sourceWorkflowId;
    this.rules.push(rule);
    this.save();
    return rule;
  }

  /**
   * 作用域查询（C.3）：通用规则始终返回，带域标签的规则需与任务描述匹配。
   * 返回结果按命中计数刷新。
   */
  getRulesForTask(taskDescription: string): Rule[] {
    const desc = taskDescription.toLowerCase();
    const matched = this.getActive().filter(r => {
      if (r.domains.length === 0) return true; // 通用规则
      return r.domains.some(d => desc.includes(d.toLowerCase()));
    });

    const selected = matched.slice(0, this.config.maxInjectedRules);
    if (selected.length > 0) {
      for (const r of selected) r.hitCount++;
      this.save();
    }
    return selected;
  }

  /**
   * 工作流结束钩子：成功的工作流刷新其涉及域的规则验证时间，
   * 其余规则的"未验证计数"+1，超过阈值进入待退役并发事件。
   */
  onWorkflowCompleted(touchedDomains: string[], success: boolean): void {
    const touched = new Set(touchedDomains.map(d => d.toLowerCase()));
    const newlyPending: Rule[] = [];

    for (const r of this.rules) {
      if (r.status === 'archived') continue;
      const isTouched = r.domains.length === 0
        || r.domains.some(d => touched.has(d.toLowerCase()));

      if (isTouched && success) {
        r.lastValidatedAt = Date.now();
        r.workflowsSinceValidation = 0;
        if (r.status === 'pending_retirement') r.status = 'active';
      } else {
        r.workflowsSinceValidation++;
        if (r.status === 'active' && r.workflowsSinceValidation >= this.config.retirementThreshold) {
          r.status = 'pending_retirement';
          newlyPending.push(r);
        }
      }
    }
    this.save();

    if (newlyPending.length > 0) {
      workflowEvents.emit('ruleRetirementProposed', {
        rules: newlyPending.map(r => ({ id: r.id, text: r.text, domains: r.domains })),
      });
    }
  }

  /** HITL 确认归档待退役规则 */
  archiveRule(id: string): boolean {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return false;
    rule.status = 'archived';
    this.save();
    return true;
  }

  /** HITL 否决退役 → 规则复活 */
  reviveRule(id: string): boolean {
    const rule = this.rules.find(r => r.id === id);
    if (!rule) return false;
    rule.status = 'active';
    rule.workflowsSinceValidation = 0;
    this.save();
    return true;
  }
}
