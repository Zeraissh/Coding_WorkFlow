/**
 * Decomposer — 智能任务拆解引擎
 *
 * 核心流程：
 * 1. 分类用户输入 → 匹配 few-shot 模板
 * 2. LLM 拆解（结构化 JSON 输出）
 * 3. 自检（可选）→ 修复隐式依赖和文件冲突
 * 4. 拓扑排序 → 输出并行批次
 */
import type { DecompositionResult, DecomposerConfig } from './types';
export interface LLMCallOptions {
    /** 模型名 */
    model?: string;
    /** Temperature */
    temperature?: number;
    /** 最大输出 token */
    maxTokens?: number;
}
export interface DecomposerDependencies {
    /** LLM 调用函数（由上层注入） */
    callLLM: (prompt: string, options?: LLMCallOptions) => Promise<string>;
}
export declare class Decomposer {
    private config;
    private llm;
    constructor(llm: DecomposerDependencies, config?: Partial<DecomposerConfig>);
    updateConfig(config: Partial<DecomposerConfig>): void;
    /**
     * 将用户任务分解为子任务
     *
     * @param userInput 用户的自然语言任务描述
     * @param projectMemory 项目的长期记忆上下文
     * @returns 拆解结果（含并行批次）
     */
    decompose(userInput: string, projectMemory?: string): Promise<DecompositionResult>;
    /**
     * 从 LLM 返回文本中解析 JSON
     */
    private parseSubtasks;
    private normalizeSubtask;
    /**
     * LLM 自检
     */
    private selfCheck;
    /**
     * 应用自检结果，修复 Subtask 列表
     */
    private applySelfCheck;
    /**
     * 构建依赖图邻接表
     */
    private buildDependencyGraph;
    /**
     * 拓扑排序，按层级分组
     * 第 0 层 = 无依赖，第 1 层 = 只依赖第 0 层，以此类推
     */
    private topoSortBatches;
    /**
     * 检测 DAG 是否有环（基于 DFS 的三色标记法）
     */
    private isAcyclic;
    private createFallbackTasks;
    private clamp;
}
//# sourceMappingURL=decomposer.d.ts.map