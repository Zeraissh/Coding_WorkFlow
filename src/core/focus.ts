/**
 * FocusMonitor — Agent 专注度监控与干预（P2.5-C.1）
 *
 * 行为信号（确定性、零额外 LLM/嵌入成本）：
 * 1. 越界写入：decomposer 已为每个子任务声明 isolatedFiles/sharedFiles，
 *    写声明之外的文件是任务漂移最直接的信号（此前该声明无人消费）
 * 2. 循环检测：同名同参工具调用重复 ≥3 次，说明 Agent 在原地打转
 * 3. 空转检测：大量只读调用而无任何文件产出，token 在烧但任务没进展
 *
 * 干预方式：把 refocus 警告追加到工具结果里回灌给 LLM（轻干预），
 * 同时发出 focusIntervention 事件供 Evaluator 归因、focusUpdate 供 Dashboard 展示。
 */

import * as path from 'path';
import { workflowEvents } from './events';
import type { Subtask } from './orchestrator/types';

export interface FocusConfig {
  enabled: boolean;
  /** 同签名调用达到该次数判定为循环 */
  repeatThreshold: number;
  /** 只读调用达到该次数且无写入判定为空转 */
  idleCallThreshold: number;
}

export const DEFAULT_FOCUS_CONFIG: FocusConfig = {
  enabled: true,
  repeatThreshold: 3,
  idleCallThreshold: 12,
};

export interface FocusSignals {
  outOfScopeWrites: string[];
  loopSignatures: string[];
  idleBurn: boolean;
}

const WRITE_TOOLS = new Set(['write_file', 'edit_file']);
const READ_TOOLS = new Set(['read_file', 'list_dir', 'grep_search', 'semantic_code_search', 'search_web']);

/** 声明路径与实际路径的宽容匹配（声明通常是相对路径，实际可能是绝对路径） */
function matchesDeclared(filePath: string, declared: string[]): boolean {
  const normalized = path.normalize(filePath).replace(/\\/g, '/').toLowerCase();
  return declared.some(d => {
    const dn = path.normalize(d).replace(/\\/g, '/').toLowerCase();
    return normalized === dn || normalized.endsWith('/' + dn) || dn.endsWith('/' + normalized);
  });
}

export class FocusMonitor {
  private config: FocusConfig;
  private task: Pick<Subtask, 'id' | 'description' | 'isolatedFiles' | 'sharedFiles'>;
  private agentId: string;

  private callCounts = new Map<string, number>();
  private warnedSignatures = new Set<string>();
  private warnedPaths = new Set<string>();
  private idleWarned = false;
  private totalCalls = 0;
  private writeCalls = 0;
  private signals: FocusSignals = { outOfScopeWrites: [], loopSignatures: [], idleBurn: false };

  constructor(
    task: Pick<Subtask, 'id' | 'description' | 'isolatedFiles' | 'sharedFiles'>,
    agentId: string,
    config?: Partial<FocusConfig>
  ) {
    this.task = task;
    this.agentId = agentId;
    this.config = { ...DEFAULT_FOCUS_CONFIG, ...config };
  }

  /**
   * 记录一次工具调用。返回需要回灌给 LLM 的 refocus 警告（无漂移时返回 undefined）。
   */
  recordToolCall(toolName: string, args: any): string | undefined {
    if (!this.config.enabled) return undefined;
    this.totalCalls++;

    const warnings: string[] = [];

    // --- 1. 越界写入 ---
    if (WRITE_TOOLS.has(toolName) && args?.path) {
      this.writeCalls++;
      const declared = [...(this.task.isolatedFiles || []), ...(this.task.sharedFiles || [])];
      // 仅当任务有文件声明时才检查（无声明 = 自由任务）
      if (declared.length > 0 && !matchesDeclared(String(args.path), declared)) {
        const p = String(args.path);
        if (!this.warnedPaths.has(p)) {
          this.warnedPaths.add(p);
          this.signals.outOfScopeWrites.push(p);
          warnings.push(
            `You are writing to "${p}" which is OUTSIDE your task's declared file scope ` +
            `[${declared.join(', ')}]. Your task is: "${this.task.description}". ` +
            `Either return to your declared files, or explain in your final answer why this file is necessary.`
          );
          this.intervene('out_of_scope_write', warnings[warnings.length - 1]!);
        }
      }
    }

    // --- 2. 循环检测 ---
    const signature = `${toolName}:${JSON.stringify(args ?? {})}`;
    const count = (this.callCounts.get(signature) || 0) + 1;
    this.callCounts.set(signature, count);
    if (count >= this.config.repeatThreshold && !this.warnedSignatures.has(signature)) {
      this.warnedSignatures.add(signature);
      this.signals.loopSignatures.push(signature);
      warnings.push(
        `You have called ${toolName} with identical arguments ${count} times. ` +
        `Repeating the same call will not change the result. Step back, reassess your approach for: "${this.task.description}".`
      );
      this.intervene('loop_detected', warnings[warnings.length - 1]!);
    }

    // --- 3. 空转检测 ---
    if (
      !this.idleWarned &&
      this.totalCalls >= this.config.idleCallThreshold &&
      this.writeCalls === 0 &&
      READ_TOOLS.has(toolName)
    ) {
      this.idleWarned = true;
      this.signals.idleBurn = true;
      warnings.push(
        `${this.totalCalls} tool calls so far with zero file output. ` +
        `If you have gathered enough context, start producing the deliverable for: "${this.task.description}".`
      );
      this.intervene('idle_burn', warnings[warnings.length - 1]!);
    }

    this.emitUpdate();
    return warnings.length > 0
      ? `\n\n⚠️ [FOCUS WARNING] ${warnings.join('\n⚠️ [FOCUS WARNING] ')}`
      : undefined;
  }

  /** 专注度评分 0-100（Dashboard 展示用） */
  getScore(): number {
    let score = 100;
    score -= this.signals.outOfScopeWrites.length * 25;
    score -= this.signals.loopSignatures.length * 25;
    if (this.signals.idleBurn) score -= 15;
    return Math.max(0, score);
  }

  getSignals(): FocusSignals {
    return {
      outOfScopeWrites: [...this.signals.outOfScopeWrites],
      loopSignatures: [...this.signals.loopSignatures],
      idleBurn: this.signals.idleBurn,
    };
  }

  private intervene(type: string, message: string): void {
    workflowEvents.emit('focusIntervention', {
      taskId: this.task.id,
      agentId: this.agentId,
      type,
      message,
    });
  }

  private emitUpdate(): void {
    workflowEvents.emit('focusUpdate', {
      taskId: this.task.id,
      agentId: this.agentId,
      score: this.getScore(),
      signals: this.getSignals(),
    });
  }
}
