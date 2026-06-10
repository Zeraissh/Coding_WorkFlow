import * as fs from 'fs';
import * as path from 'path';

const MEMORY_FILE = path.join('.workflow', 'project_rules.md');

/**
 * 获取项目维度的长期记忆（规范、偏好、踩过的坑）
 */
export function getProjectMemory(cwd: string = process.cwd()): string {
  const memoryPath = path.join(cwd, MEMORY_FILE);
  if (fs.existsSync(memoryPath)) {
    return fs.readFileSync(memoryPath, 'utf-8').trim();
  }
  return '';
}

/**
 * 向长期记忆中追加新的规范或经验教训
 */
export function appendProjectMemory(newRule: string, cwd: string = process.cwd()): void {
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
