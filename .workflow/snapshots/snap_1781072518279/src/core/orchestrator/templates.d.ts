/**
 * Orchestrator 拆解模板 — 通用领域的 few-shot 示例库
 *
 * 每种任务类型提供 3 个示例，供 LLM 参考拆解粒度、依赖声明和文件分配方式。
 */
import type { Subtask, DecomposerConfig } from './types';
export interface FewShotExample {
    input: string;
    context?: string;
    subtasks: Subtask[];
}
export interface TaskTemplate {
    category: DecomposerConfig['fewShotCategory'];
    systemPrompt: string;
    examples: FewShotExample[];
}
/**
 * 获取指定类别的模板
 */
export declare function getTemplate(category: DecomposerConfig['fewShotCategory']): TaskTemplate;
/**
 * 自动检测任务类别
 */
export declare function detectCategory(userInput: string): DecomposerConfig['fewShotCategory'];
/**
 * 构建拆解 prompt（JSON 输出格式）
 */
export declare function buildDecompositionPrompt(userInput: string, category: DecomposerConfig['fewShotCategory'], config: DecomposerConfig, projectMemory?: string): string;
/**
 * 构建自检 prompt
 */
export declare function buildSelfCheckPrompt(subtasks: Subtask[]): string;
//# sourceMappingURL=templates.d.ts.map