import * as fs from 'fs';
import * as path from 'path';
import { askLLM } from '../llm/client';
const MEMORY_FILE = path.join('.workflow', 'project_rules.md');
/**
 * 获取项目维度的长期记忆（规范、偏好、踩过的坑）
 */
export function getProjectMemory(cwd = process.cwd()) {
    const memoryPath = path.join(cwd, MEMORY_FILE);
    if (fs.existsSync(memoryPath)) {
        return fs.readFileSync(memoryPath, 'utf-8').trim();
    }
    return '';
}
/**
 * 向长期记忆中追加新的规范或经验教训
 */
export function appendProjectMemory(newRule, cwd = process.cwd()) {
    const memoryPath = path.join(cwd, MEMORY_FILE);
    const dir = path.dirname(memoryPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    let content = '';
    if (fs.existsSync(memoryPath)) {
        content = fs.readFileSync(memoryPath, 'utf-8').trim();
    }
    content += (content.length > 0 ? '\n' : '') + newRule;
    fs.writeFileSync(memoryPath, content, 'utf-8');
}
/**
 * Extracts lessons and rules from a completed workflow's execution logs using the LLM,
 * and appends them to the project memory.
 */
export async function extractLessons(goal, logs) {
    if (logs.length === 0)
        return;
    const errorLogs = logs.flatMap(log => log.errors).filter(err => err.length > 0);
    if (errorLogs.length === 0)
        return; // No major errors to learn from
    const prompt = `You are a meta-learning agent. Your goal is to analyze the errors encountered during a recent workflow and extract 1 or 2 concise, actionable rules to prevent these errors in the future.
  
Original Goal: ${goal}
Errors Encountered:
${errorLogs.map(e => `- ${e}`).join('\n')}

Output ONLY the markdown bullet points for the new rules. No introductory text.`;
    try {
        const response = await askLLM(prompt, [{ role: 'user', content: 'Extract lessons learned.' }], undefined, undefined, 0.3);
        const contentText = response.content.find(block => block.type === 'text');
        if (contentText && contentText.type === 'text' && contentText.text.trim()) {
            appendProjectMemory(`\n### Lessons from: ${goal}\n` + contentText.text.trim());
        }
    }
    catch (e) {
        console.warn('Failed to extract lessons for memory:', e);
    }
}
//# sourceMappingURL=memory.js.map