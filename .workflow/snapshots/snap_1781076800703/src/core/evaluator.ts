import * as fs from 'fs';
import * as path from 'path';
import { workflowEvents } from './events';

export interface EvalRecord {
  timestamp: number;
  workflowId: string;
  totalTasks: number;
  successfulTasks: number;
  totalTokens: number;
  cachedTokens: number;
  totalLlmCalls: number;
  totalDurationMs: number;
  /** 缓存命中率 (0-100) */
  cacheHitRate: number;
  /** 节省的 Token 成本估算 (USD) */
  estimatedSavings: number;
  /** LLM 提供商 */
  provider: string;
}

export class Evaluator {
  private logFile: string;
  private records: EvalRecord[] = [];
  private currentWorkflowId: string | null = null;
  private currentStats = {
    tasks: 0,
    successes: 0,
    tokens: 0,
    cachedTokens: 0,
    llmCalls: 0,
    startTime: 0,
    provider: '',
  };

  constructor(cwd: string = process.cwd()) {
    this.logFile = path.join(cwd, '.workflow', 'eval_logs.json');
    this.loadLogs();
    this.setupListeners();
  }

  private loadLogs() {
    if (fs.existsSync(this.logFile)) {
      try {
        this.records = JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));
      } catch (e) {
        this.records = [];
      }
    }
  }

  private saveLogs() {
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.logFile, JSON.stringify(this.records, null, 2));
  }

  private setupListeners() {
    workflowEvents.on('workflowStarted', () => {
      this.currentWorkflowId = `wf_${Date.now()}`;
      this.currentStats = { tasks: 0, successes: 0, tokens: 0, cachedTokens: 0, llmCalls: 0, startTime: Date.now(), provider: '' };
    });

    workflowEvents.on('taskCompleted', (data: { success: boolean }) => {
      this.currentStats.tasks++;
      if (data.success) this.currentStats.successes++;
    });

    workflowEvents.on('llmUsageReport', (data: { tokens: number; cachedTokens: number; calls: number; cacheHitRate?: number; provider?: string }) => {
      this.currentStats.tokens += data.tokens;
      this.currentStats.cachedTokens += data.cachedTokens;
      this.currentStats.llmCalls += data.calls;
      if (data.provider && !this.currentStats.provider) {
        this.currentStats.provider = data.provider;
      }
    });

    workflowEvents.on('workflowCompleted', () => {
      if (this.currentWorkflowId) {
        const totalInputTokens = this.currentStats.tokens;
        const cacheHitRate = totalInputTokens > 0
          ? Math.round((this.currentStats.cachedTokens / Math.max(totalInputTokens, 1)) * 100)
          : 0;

        // 估算节省成本: Anthropic $3/M input tokens, cached $0.30/M → 节省 $2.70/M cached tokens
        const savingsPerMillion = 2.70;
        const estimatedSavings = (this.currentStats.cachedTokens / 1_000_000) * savingsPerMillion;

        this.records.push({
          timestamp: Date.now(),
          workflowId: this.currentWorkflowId,
          totalTasks: this.currentStats.tasks,
          successfulTasks: this.currentStats.successes,
          totalTokens: this.currentStats.tokens,
          cachedTokens: this.currentStats.cachedTokens,
          totalLlmCalls: this.currentStats.llmCalls,
          totalDurationMs: Date.now() - this.currentStats.startTime,
          cacheHitRate,
          estimatedSavings: Math.round(estimatedSavings * 100) / 100,
          provider: this.currentStats.provider,
        });
        this.saveLogs();
        workflowEvents.emit('evalUpdated', this.records);
      }
    });
  }

  public getLogs() {
    return this.records;
  }
}
