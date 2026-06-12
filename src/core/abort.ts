/**
 * 工作流级 E-Stop：单一 AbortController 贯穿 orchestrator → agent → LLM 调用。
 * Dashboard 的 /api/stop 或 CLI Ctrl+C 都通过 stopWorkflow() 触发。
 */

import { workflowEvents } from './events';

let current: AbortController | null = null;

/** 工作流启动时调用，创建新的中止控制器 */
export function beginWorkflowAbortScope(): AbortController {
  current = new AbortController();
  return current;
}

/** 当前工作流的中止信号（无活跃工作流时返回 undefined） */
export function getWorkflowSignal(): AbortSignal | undefined {
  return current?.signal;
}

/** 是否已请求停止 */
export function isWorkflowStopped(): boolean {
  return current?.signal.aborted ?? false;
}

/** 紧急停止当前工作流 */
export function stopWorkflow(reason: string = 'User requested stop'): boolean {
  if (!current || current.signal.aborted) return false;
  current.abort(new Error(reason));
  workflowEvents.emit('workflowStopped', { reason, timestamp: Date.now() });
  return true;
}

/** 工作流结束后清理 */
export function endWorkflowAbortScope(): void {
  current = null;
}
