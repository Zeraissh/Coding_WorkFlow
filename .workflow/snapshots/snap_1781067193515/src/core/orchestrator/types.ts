/**
 * Orchestrator 拆解相关类型定义
 *
 * 供 decomposer.ts / tokenBudget.ts / verifier 共用
 */

export interface Subtask {
  /** 唯一标识 */
  id: string;
  /** 自然语言描述 */
  description: string;
  /** 1-10, 用于 Token 预算分配权重 */
  estimatedComplexity: number;
  /** 依赖的子任务 ID 列表 */
  dependencies: string[];
  /** 独占文件路径 (防止并发写冲突) */
  isolatedFiles: string[];
  /** 共享只读文件路径 */
  sharedFiles: string[];
  /** 期望产出物描述 (供 Verifier 校验) */
  expectedOutput: string;
}

export interface DecompositionResult {
  subtasks: Subtask[];
  /** DAG 邻接表: taskId → 它所依赖的 taskIds */
  dependencyGraph: Map<string, string[]>;
  /** 拓扑分层后的并行批次 (每层内可完全并行) */
  parallelBatches: Subtask[][];
  /** 拆解质量自查中的警告信息 */
  warnings: string[];
}

export interface DecomposerConfig {
  /** 最大子任务数, 默认 8 */
  maxSubtasks: number;
  /** 复杂度低于此值的任务不再拆, 默认 2 */
  minComplexityForSplit: number;
  /** 是否启用 LLM 自检, 默认 true */
  enableSelfCheck: boolean;
  /** few-shot 模板类别 */
  fewShotCategory: 'general' | 'code' | 'bugfix' | 'auto';
}

export const DEFAULT_DECOMPOSER_CONFIG: DecomposerConfig = {
  maxSubtasks: 8,
  minComplexityForSplit: 2,
  enableSelfCheck: true,
  fewShotCategory: 'auto',
};
