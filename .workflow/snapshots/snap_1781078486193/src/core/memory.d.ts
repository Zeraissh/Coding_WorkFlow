import { AgentExecutionLog } from '../types/workflow';
/**
 * 获取项目维度的长期记忆（规范、偏好、踩过的坑）
 */
export declare function getProjectMemory(cwd?: string): string;
/**
 * 向长期记忆中追加新的规范或经验教训
 */
export declare function appendProjectMemory(newRule: string, cwd?: string): void;
/**
 * Extracts lessons and rules from a completed workflow's execution logs using the LLM,
 * and appends them to the project memory.
 */
export declare function extractLessons(goal: string, logs: AgentExecutionLog[]): Promise<void>;
//# sourceMappingURL=memory.d.ts.map