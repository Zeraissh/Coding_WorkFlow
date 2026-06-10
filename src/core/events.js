import { EventEmitter } from 'events';
export const workflowEvents = new EventEmitter();
// Event signatures:
// 'workflowStarted', { goal: string, totalTasks: number }
// 'taskStarted', { taskId: string, description: string }
// 'log', { taskId: string, message: string }
// 'taskCompleted', { taskId: string, result: string, success: boolean }
// 'approvalRequested', { taskId: string, toolName: string, arguments: any, resolve: () => void, reject: (err: Error) => void }
// 'workflowCompleted', { result: string }
// 'llmUsageReport', { tokens: number, cachedTokens: number, calls: number, cacheHitRate: number, provider: string }
// 'evalUpdated', EvalRecord[]
//# sourceMappingURL=events.js.map