import * as fs from 'fs';
import * as path from 'path';
import { askLLM } from '../llm/client';
import { AgentExecutionLog } from '../types/workflow';
import { RuleStore } from './rules';

const MEMORY_FILE = path.join('.workflow', 'project_rules.md');

/**
 * 获取项目维度的长期记忆（规范、偏好、踩过的坑）
 * 读取 RuleStore 渲染出的 md，全量文本（Orchestrator/Dashboard 使用；
 * Agent 应改用 RuleStore.getRulesForTask 做作用域注入）
 */
export function getProjectMemory(cwd: string = process.cwd()): string {
  const memoryPath = path.join(cwd, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    return fs.readFileSync(memoryPath, 'utf-8').trim();
  }
  return '';
}

/**
 * 向长期记忆中追加新的规范或经验教训（经 RuleStore 去重）
 */
export function appendProjectMemory(newRule: string, cwd: string = process.cwd()): void {
  new RuleStore(cwd).addRule(newRule);
}

/**
 * Extracts lessons from a completed workflow's execution logs using the LLM,
 * tags them with domains, and merges them into the RuleStore (deduplicated).
 */
export async function extractLessons(goal: string, logs: AgentExecutionLog[]): Promise<void> {
  if (logs.length === 0) return;

  const errorLogs = logs.flatMap(log => log.errors).filter(err => err.length > 0);
  if (errorLogs.length === 0) return; // No major errors to learn from

  const prompt = `You are a meta-learning agent. Analyze the errors encountered during a recent workflow and extract 1 or 2 concise, actionable rules to prevent these errors in the future.

Original Goal: ${goal}
Errors Encountered:
${errorLogs.map(e => `- ${e}`).join('\n')}

For each rule also assign 1-3 lowercase domain tags describing when the rule applies (e.g. "python", "typescript", "git", "shell", "testing", "windows", "serial").

Return ONLY a JSON array in a \`\`\`json block: [{ "text": "...", "domains": ["..."] }]. No introductory text.`;

  try {
    const response = await askLLM(
      prompt,
      [{ role: 'user', content: 'Extract lessons learned.' }],
      undefined,
      undefined,
      0.3
    );
    const contentText = response.content.find(block => block.type === 'text');
    if (!contentText || contentText.type !== 'text') return;

    const match = contentText.text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    const jsonStr = (match?.[1] ?? contentText.text).trim();

    let lessons: Array<{ text: string; domains?: string[] }> = [];
    try {
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed)) {
        lessons = parsed.filter(l => l && typeof l.text === 'string' && l.text.trim().length > 0);
      }
    } catch {
      // 兜底：非 JSON 输出按旧格式整段收为一条无标签规则
      if (contentText.text.trim()) {
        lessons = [{ text: contentText.text.trim() }];
      }
    }

    if (lessons.length === 0) return;
    const store = new RuleStore();
    for (const lesson of lessons) {
      store.addRule(
        lesson.text.trim(),
        Array.isArray(lesson.domains) ? lesson.domains.map(d => String(d).toLowerCase()) : []
      );
    }
  } catch (e) {
    console.warn('Failed to extract lessons for memory:', e);
  }
}
