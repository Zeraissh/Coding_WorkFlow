import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { workflowEvents } from './events';

/**
 * 提示词体系版本号：每次对 decomposer/agent/verifier 的提示词模板做实质性修改时 +1。
 * 写入每条 Eval 记录，使"哪个提示词版本导致成功率变化"可被查询与回滚。
 */
export const PROMPT_VERSION = 1;

/** 单个子任务的归因明细 */
export interface TaskEvalDetail {
  taskId: string;
  agentId?: string;
  success: boolean;
  /** Agent 执行日志中记录的错误条数 */
  errorCount: number;
  /** 专注度干预次数（来自 FocusMonitor） */
  interventions: number;
}

/** 验证阶段的结构化结果（来自 Verifier 的 verificationReport 事件） */
export interface VerificationSummary {
  passed: boolean | null;
  lintErrors: number;
  typeErrors: number;
  fileConflicts: number;
  interfaceMismatches: number;
  semanticIssues: number;
}

export interface EvalRecord {
  timestamp: number;
  workflowId: string;
  totalTasks: number;
  successfulTasks: number;
  totalTokens: number;
  cachedTokens: number;
  totalLlmCalls: number;
  totalDurationMs: number;
  cacheHitRate: number;
  estimatedSavings: number;
  provider: string;
  // --- 归因字段 ---
  /** 工作流开始时生效的项目规则集内容 hash（追踪规则变更对成功率的影响） */
  rulesHash: string;
  /** 提示词体系版本 */
  promptVersion: number;
  /** per-task 明细 */
  tasks: TaskEvalDetail[];
  /** 验证阶段结构化结果 */
  verification?: VerificationSummary;
  /** 是否被用户 E-Stop 中止 */
  stopped: boolean;
}

function hashRules(cwd: string): string {
  try {
    const rulesPath = path.join(cwd, '.workflow', 'project_rules.md');
    if (!fs.existsSync(rulesPath)) return 'none';
    const content = fs.readFileSync(rulesPath, 'utf-8');
    return crypto.createHash('sha1').update(content).digest('hex').slice(0, 12);
  } catch {
    return 'unknown';
  }
}

export class Evaluator {
  private logFile: string;
  private cwd: string;
  private records: EvalRecord[] = [];
  private currentWorkflowId: string | null = null;
  private currentStats = this.freshStats();
  private listeners: Array<{ event: string; handler: (...args: any[]) => void }> = [];

  constructor(cwd: string = process.cwd()) {
    this.cwd = cwd;
    this.logFile = path.join(cwd, '.workflow', 'eval_logs.json');
    this.loadLogs();
    this.setupListeners();
  }

  private freshStats() {
    return {
      tasks: 0,
      successes: 0,
      tokens: 0,
      cachedTokens: 0,
      llmCalls: 0,
      startTime: 0,
      provider: '',
      rulesHash: 'none',
      taskDetails: [] as TaskEvalDetail[],
      verification: undefined as VerificationSummary | undefined,
      stopped: false,
    };
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
    // 原子写，与 stateManager 同策略
    const tmpFile = `${this.logFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(this.records, null, 2));
    fs.renameSync(tmpFile, this.logFile);
  }

  private on(event: string, handler: (...args: any[]) => void) {
    workflowEvents.on(event, handler);
    this.listeners.push({ event, handler });
  }

  /** 移除全部事件监听（测试/多实例场景必须调用） */
  dispose(): void {
    for (const { event, handler } of this.listeners) {
      workflowEvents.off(event, handler);
    }
    this.listeners = [];
  }

  private setupListeners() {
    this.on('workflowStarted', () => {
      this.currentWorkflowId = `wf_${Date.now()}`;
      this.currentStats = this.freshStats();
      this.currentStats.startTime = Date.now();
      this.currentStats.rulesHash = hashRules(this.cwd);
    });

    this.on('taskCompleted', (data: { taskId?: string; success: boolean; agentId?: string; executionLog?: any }) => {
      this.currentStats.tasks++;
      if (data.success) this.currentStats.successes++;

      const detail: TaskEvalDetail = {
        taskId: data.taskId || `task_${this.currentStats.tasks}`,
        success: data.success,
        errorCount: Array.isArray(data.executionLog?.errors)
          ? data.executionLog.errors.filter((e: string) => e && e.length > 0).length
          : 0,
        interventions: 0,
      };
      if (data.agentId) detail.agentId = data.agentId;
      this.currentStats.taskDetails.push(detail);
    });

    this.on('focusIntervention', (data: { taskId?: string; agentId?: string }) => {
      // 任务可能尚未完成（明细还没建），先记到暂存表；完成时合并
      const detail = this.currentStats.taskDetails.find(
        t => (data.taskId && t.taskId === data.taskId) || (data.agentId && t.agentId === data.agentId)
      );
      if (detail) {
        detail.interventions++;
      } else {
        this.pendingInterventions.push(data);
      }
    });

    this.on('verificationReport', (data: VerificationSummary) => {
      this.currentStats.verification = data;
    });

    this.on('workflowStopped', () => {
      this.currentStats.stopped = true;
    });

    this.on('llmUsageReport', (data: { tokens: number; cachedTokens: number; calls: number; cacheHitRate?: number; provider?: string }) => {
      this.currentStats.tokens += data.tokens;
      this.currentStats.cachedTokens += data.cachedTokens;
      this.currentStats.llmCalls += data.calls;
      if (data.provider && !this.currentStats.provider) {
        this.currentStats.provider = data.provider;
      }
    });

    this.on('workflowCompleted', () => {
      if (!this.currentWorkflowId) return;

      // 合并任务完成前发生的干预记录
      for (const p of this.pendingInterventions) {
        const detail = this.currentStats.taskDetails.find(
          t => (p.taskId && t.taskId === p.taskId) || (p.agentId && t.agentId === p.agentId)
        );
        if (detail) detail.interventions++;
      }
      this.pendingInterventions = [];

      const totalInputTokens = this.currentStats.tokens;
      const cacheHitRate = totalInputTokens > 0
        ? Math.round((this.currentStats.cachedTokens / Math.max(totalInputTokens, 1)) * 100)
        : 0;

      // Estimate cost savings: Anthropic $3/M input tokens, cached $0.30/M -> savings $2.70/M cached tokens
      const savingsPerMillion = 2.70;
      const estimatedSavings = (this.currentStats.cachedTokens / 1_000_000) * savingsPerMillion;

      const record: EvalRecord = {
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
        provider: this.currentStats.provider || 'unknown',
        rulesHash: this.currentStats.rulesHash,
        promptVersion: PROMPT_VERSION,
        tasks: this.currentStats.taskDetails,
        stopped: this.currentStats.stopped,
      };
      if (this.currentStats.verification) record.verification = this.currentStats.verification;

      this.records.push(record);
      this.saveLogs();
      workflowEvents.emit('evalUpdated', this.getLogs());
      this.currentWorkflowId = null;
    });
  }

  private pendingInterventions: Array<{ taskId?: string; agentId?: string }> = [];

  /**
   * 质量分：以任务成功率为主（70%）、验证通过率为辅（30%）。
   * 缓存命中率是成本指标，不参与质量评分（修正旧版公式权重失衡）。
   */
  public calculateQualityScore(): number {
    if (this.records.length === 0) return 0;

    let totalTasks = 0, successTasks = 0;
    let verifiedRuns = 0, passedRuns = 0;

    for (const r of this.records) {
      totalTasks += r.totalTasks;
      successTasks += r.successfulTasks;
      if (r.verification && r.verification.passed !== null) {
        verifiedRuns++;
        if (r.verification.passed) passedRuns++;
      }
    }

    const successRate = totalTasks > 0 ? (successTasks / totalTasks) : 0;
    const verifyRate = verifiedRuns > 0 ? (passedRuns / verifiedRuns) : successRate;
    return Math.round(((successRate * 0.7) + (verifyRate * 0.3)) * 100);
  }

  /** @deprecated 旧公式把缓存命中率当质量指标，保留只为兼容；请用 calculateQualityScore */
  public calculateRetentionScore(): number {
    return this.calculateQualityScore();
  }

  public getLogs() {
    return {
      records: this.records,
      retentionScore: this.calculateQualityScore(),
    };
  }
}
