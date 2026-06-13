/**
 * WorkflowTracer — 结构化运行 trace + 成本估算（观测性）
 *
 * 订阅 workflowEvents，把一次工作流的完整执行装配成可查询的 JSON 记录：
 * workflow → 每个 task 的状态/token/LLM 调用/改动文件/专注度 → 总 token/成本/耗时。
 * 工作流结束时原子写入 .workflow/traces/<id>.json，并 emit costReport 供 Dashboard。
 *
 * 与 Evaluator 的分工：Evaluator 记录"质量归因摘要"喂给自我改进闭环；
 * Tracer 记录"完整执行明细 + 成本"用于调试与可观测性。
 */

import * as fs from 'fs';
import * as path from 'path';
import { workflowEvents } from './events';

/**
 * 各模型每百万 token 的近似单价（美元）。会变动，按需在此调整。
 * 价值在于"token → 成本"这个机制本身，而非精确到分。
 */
export const MODEL_PRICING: Record<string, { input: number; cachedInput: number; output: number }> = {
  'claude-opus':    { input: 15,   cachedInput: 1.5,  output: 75 },
  'claude-fable':   { input: 15,   cachedInput: 1.5,  output: 75 },
  'claude-sonnet':  { input: 3,    cachedInput: 0.3,  output: 15 },
  'claude-haiku':   { input: 0.8,  cachedInput: 0.08, output: 4 },
  'gpt-4o':         { input: 2.5,  cachedInput: 1.25, output: 10 },
  'gpt-4':          { input: 30,   cachedInput: 15,   output: 60 },
  'o1':             { input: 15,   cachedInput: 7.5,  output: 60 },
  'o3':             { input: 2,    cachedInput: 0.5,  output: 8 },
  'deepseek':       { input: 0.27, cachedInput: 0.07, output: 1.1 },
};

const DEFAULT_PRICE = { input: 3, cachedInput: 0.3, output: 15 };

function priceFor(model: string): { input: number; cachedInput: number; output: number } {
  const m = (model || '').toLowerCase();
  for (const key of Object.keys(MODEL_PRICING)) {
    if (m.includes(key)) return MODEL_PRICING[key]!;
  }
  return DEFAULT_PRICE;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
}

/** 估算一次用量的成本（美元）。缓存命中部分按缓存价，其余 input 按标准 input 价。 */
export function estimateCostUsd(usage: TokenUsage, model: string): number {
  const p = priceFor(model);
  const uncachedInput = Math.max(0, usage.inputTokens - usage.cachedTokens);
  const cost =
    (uncachedInput / 1_000_000) * p.input +
    (usage.cachedTokens / 1_000_000) * p.cachedInput +
    (usage.outputTokens / 1_000_000) * p.output;
  return Math.round(cost * 1_000_000) / 1_000_000; // 6 位小数
}

export interface TaskTrace {
  taskId: string;
  description?: string;
  status: 'running' | 'completed' | 'failed';
  tokens: number;
  llmCalls: number;
  filesChanged: string[];
  focusScore?: number;
}

export interface RunTrace {
  workflowId: string;
  goal: string;
  startedAt: number;
  endedAt: number | null;
  durationMs: number | null;
  tasks: TaskTrace[];
  totals: {
    tokens: number;
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    llmCalls: number;
    estimatedCostUsd: number;
  };
  stopped: boolean;
}

export class WorkflowTracer {
  private cwd: string;
  private trace: RunTrace | null = null;
  private taskMap = new Map<string, TaskTrace>();
  private listeners: Array<{ event: string; handler: (...a: any[]) => void }> = [];

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.setup();
  }

  private on(event: string, handler: (...a: any[]) => void) {
    workflowEvents.on(event, handler);
    this.listeners.push({ event, handler });
  }

  dispose(): void {
    for (const { event, handler } of this.listeners) workflowEvents.off(event, handler);
    this.listeners = [];
  }

  getCurrentTrace(): RunTrace | null {
    return this.trace;
  }

  private task(taskId: string): TaskTrace {
    let t = this.taskMap.get(taskId);
    if (!t) {
      t = { taskId, status: 'running', tokens: 0, llmCalls: 0, filesChanged: [] };
      this.taskMap.set(taskId, t);
    }
    return t;
  }

  private setup() {
    this.on('workflowStarted', (data: { goal?: string }) => {
      this.taskMap.clear();
      this.trace = {
        workflowId: `wf_${Date.now()}`,
        goal: data?.goal || '',
        startedAt: Date.now(),
        endedAt: null,
        durationMs: null,
        tasks: [],
        totals: { tokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, llmCalls: 0, estimatedCostUsd: 0 },
        stopped: false,
      };
    });

    this.on('taskStarted', (data: { taskId: string; description?: string }) => {
      if (!this.trace || !data?.taskId) return;
      const t = this.task(data.taskId);
      if (data.description) t.description = data.description;
      t.status = 'running';
    });

    this.on('taskCompleted', (data: { taskId?: string; success?: boolean }) => {
      if (!this.trace || !data?.taskId) return;
      this.task(data.taskId).status = data.success ? 'completed' : 'failed';
    });

    this.on('llmUsageReport', (d: any) => {
      if (!this.trace) return;
      const input = d.inputTokens ?? 0;
      const output = d.outputTokens ?? 0;
      const cached = d.cachedTokens ?? 0;
      const calls = d.calls ?? 1;
      this.trace.totals.tokens += d.tokens ?? input + output;
      this.trace.totals.inputTokens += input;
      this.trace.totals.outputTokens += output;
      this.trace.totals.cachedTokens += cached;
      this.trace.totals.llmCalls += calls;
      this.trace.totals.estimatedCostUsd += estimateCostUsd(
        { inputTokens: input, outputTokens: output, cachedTokens: cached },
        d.model || 'unknown'
      );
      // 归到任务桶（orchestrator/verifier 等无任务的调用只计入总计）
      if (d.taskId && d.taskId !== 'orchestrator' && d.taskId !== 'verifier') {
        const t = this.task(d.taskId);
        t.tokens += d.tokens ?? input + output;
        t.llmCalls += calls;
      }
    });

    this.on('fileChanged', (d: any) => {
      if (!this.trace) return;
      const file = d?.file || d?.path;
      if (d?.taskId && file) {
        const t = this.task(d.taskId);
        if (!t.filesChanged.includes(file)) t.filesChanged.push(file);
      }
    });

    this.on('focusUpdate', (d: { taskId?: string; score?: number }) => {
      if (!this.trace || !d?.taskId || d.score == null) return;
      this.task(d.taskId).focusScore = d.score;
    });

    this.on('workflowStopped', () => {
      if (this.trace) this.trace.stopped = true;
    });

    this.on('workflowCompleted', () => {
      if (!this.trace) return;
      this.trace.endedAt = Date.now();
      this.trace.durationMs = this.trace.endedAt - this.trace.startedAt;
      this.trace.totals.estimatedCostUsd = Math.round(this.trace.totals.estimatedCostUsd * 1_000_000) / 1_000_000;
      this.trace.tasks = Array.from(this.taskMap.values());
      this.write(this.trace);
      workflowEvents.emit('costReport', {
        workflowId: this.trace.workflowId,
        estimatedCostUsd: this.trace.totals.estimatedCostUsd,
        tokens: this.trace.totals.tokens,
        cachedTokens: this.trace.totals.cachedTokens,
        durationMs: this.trace.durationMs,
      });
    });
  }

  private write(trace: RunTrace): void {
    try {
      const dir = path.join(this.cwd, '.workflow', 'traces');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${trace.workflowId}.json`);
      const tmp = `${file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(trace, null, 2), 'utf-8');
      fs.renameSync(tmp, file);
    } catch (e: any) {
      console.warn(`[tracer] Failed to write trace: ${e.message}`);
    }
  }
}
