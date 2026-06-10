import * as fs from 'fs';
import * as path from 'path';
import { workflowEvents } from './events';
export class Evaluator {
    logFile;
    records = [];
    currentWorkflowId = null;
    currentStats = {
        tasks: 0,
        successes: 0,
        tokens: 0,
        cachedTokens: 0,
        llmCalls: 0,
        startTime: 0
    };
    constructor(cwd = process.cwd()) {
        this.logFile = path.join(cwd, '.workflow', 'eval_logs.json');
        this.loadLogs();
        this.setupListeners();
    }
    loadLogs() {
        if (fs.existsSync(this.logFile)) {
            try {
                this.records = JSON.parse(fs.readFileSync(this.logFile, 'utf-8'));
            }
            catch (e) {
                this.records = [];
            }
        }
    }
    saveLogs() {
        const dir = path.dirname(this.logFile);
        if (!fs.existsSync(dir))
            fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(this.logFile, JSON.stringify(this.records, null, 2));
    }
    setupListeners() {
        workflowEvents.on('workflowStarted', () => {
            this.currentWorkflowId = `wf_${Date.now()}`;
            this.currentStats = { tasks: 0, successes: 0, tokens: 0, cachedTokens: 0, llmCalls: 0, startTime: Date.now() };
        });
        workflowEvents.on('taskCompleted', (data) => {
            this.currentStats.tasks++;
            if (data.success)
                this.currentStats.successes++;
        });
        workflowEvents.on('llmUsageReport', (data) => {
            this.currentStats.tokens += data.tokens;
            this.currentStats.cachedTokens += data.cachedTokens;
            this.currentStats.llmCalls += data.calls;
        });
        workflowEvents.on('workflowCompleted', () => {
            if (this.currentWorkflowId) {
                this.records.push({
                    timestamp: Date.now(),
                    workflowId: this.currentWorkflowId,
                    totalTasks: this.currentStats.tasks,
                    successfulTasks: this.currentStats.successes,
                    totalTokens: this.currentStats.tokens,
                    cachedTokens: this.currentStats.cachedTokens,
                    totalLlmCalls: this.currentStats.llmCalls,
                    totalDurationMs: Date.now() - this.currentStats.startTime
                });
                this.saveLogs();
                workflowEvents.emit('evalUpdated', this.getLogs());
            }
        });
    }
    calculateRetentionScore() {
        if (this.records.length === 0)
            return 0;
        let totalTokens = 0, cachedTokens = 0;
        let totalTasks = 0, successTasks = 0;
        for (const r of this.records) {
            totalTokens += r.totalTokens;
            cachedTokens += r.cachedTokens;
            totalTasks += r.totalTasks;
            successTasks += r.successfulTasks;
        }
        const cacheHitRate = totalTokens > 0 ? (cachedTokens / totalTokens) : 0;
        const successRate = totalTasks > 0 ? (successTasks / totalTasks) : 0;
        // Custom formula: (CacheHitRate * 0.6) + (TaskSuccessRate * 0.4)
        const score = (cacheHitRate * 0.6) + (successRate * 0.4);
        return Math.round(score * 100);
    }
    getLogs() {
        return {
            records: this.records,
            retentionScore: this.calculateRetentionScore()
        };
    }
}
//# sourceMappingURL=evaluator.js.map