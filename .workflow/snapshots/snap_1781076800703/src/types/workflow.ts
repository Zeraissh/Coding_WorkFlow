export interface SubTask {
  id: string;
  description: string;
  /** 1-10, 用于 Token 预算权重分配和拆解粒度判断 */
  estimatedComplexity?: number;
  /** 依赖的子任务 ID 列表 */
  dependencies?: string[];
  /** 独占写入文件路径（防止并发写冲突） */
  isolatedFiles?: string[];
  /** 共享只读文件路径 */
  sharedFiles?: string[];
  expectedOutput: string;
}

export interface Plan {
  goal: string;
  tasks: SubTask[];
  /** 拓扑分层后的并行批次（每层内可完全并行） */
  parallelBatches?: SubTask[][];
  /** 拆解质量自查警告 */
  warnings?: string[];
}

export interface TaskResult {
  taskId: string;
  result: string;
  success: boolean;
  error?: string;
}

// ============================================================================
// Agent 执行日志（供 Verifier 第一阶段消费）
// ============================================================================

export interface AgentFileOp {
  agentId: string;
  subtaskId: string;
  operation: 'write' | 'read' | 'delete';
  filePath: string;
  content?: string;
  timestamp: number;
}

export interface AgentExecutionLog {
  agentId: string;
  subtaskId: string;
  files: AgentFileOp[];
  shellCommands: string[];
  llmCalls: number;
  tokensUsed: number;
  errors: string[];
}
