/**
 * Workflow lock — 进程内工作流互斥。
 *
 * 引擎的若干跨切面状态是进程级单例：abort scope、sandbox session、
 * tokenBudget、fslock。两个工作流在同一进程并发执行（典型：MCP server
 * 同时收到多个 run_workflow）会互相踩——一个的 E-Stop 中止另一个、预算
 * 与文件锁混淆、沙箱会话被覆盖。
 *
 * 因此 executeWorkflow 串行化：第二个调用排队等第一个跑完，而非并发。
 * 这把"一进程一工作流"的隐含假设显式化为安全保证。真正的并行多工作流
 * 应起多进程（每进程独立单例）。
 */

let _tail: Promise<unknown> = Promise.resolve();
let _running = false;

/** 串行执行：排在当前队尾，前面的工作流跑完才开始。 */
export function runExclusiveWorkflow<T>(fn: () => Promise<T>): Promise<T> {
  const run = _tail.then(async () => {
    _running = true;
    try {
      return await fn();
    } finally {
      _running = false;
    }
  });
  // 队尾推进；吞掉错误避免一个失败的工作流卡死整条队列
  _tail = run.catch(() => undefined);
  return run;
}

/** 是否有工作流正在执行（本进程） */
export function isWorkflowRunning(): boolean {
  return _running;
}
