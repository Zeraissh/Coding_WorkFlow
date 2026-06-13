/**
 * Workflow observers — 把观测/归因绑定到引擎，而非传输层。
 *
 * 此前 Tracer/Evaluator 只在 dashboard server 里实例化，导致：
 * - 编程式 SDK 调用（new Orchestrator().executeWorkflow）零 trace/eval
 * - 不开 dashboard 的纯 CLI 同样缺失
 * - 进化闭环的归因数据（eval_logs.json）在主路径根本不采集
 *
 * 现在由 executeWorkflow 在其生命周期内统一启停，保证 CLI / SDK / MCP
 * 三条路径都一致拿到结构化 trace + eval 归因。
 */

import { WorkflowTracer } from './tracer';
import { Evaluator } from './evaluator';

export interface WorkflowObservers {
  dispose(): void;
}

/**
 * 启动本次工作流的观测器（结构化 trace + eval 归因）。
 * 二者都订阅事件总线、在 workflowCompleted 时落盘；返回 dispose 解绑监听。
 */
export function startWorkflowObservers(cwd: string = process.cwd()): WorkflowObservers {
  const tracer = new WorkflowTracer(cwd);
  const evaluator = new Evaluator(cwd);
  return {
    dispose() {
      tracer.dispose();
      evaluator.dispose();
    },
  };
}
