import * as path from 'path';

/**
 * 工具层安全防线：
 * 1. 路径越界防护 —— 文件类工具只允许操作项目根目录以内的路径
 * 2. 危险命令拦截 —— 终端工具对毁灭性命令直接拒绝（不依赖 HITL 是否开启）
 *
 * 注意：命令黑名单是尽力而为的兜底，真正的安全门是 HITL 审批；
 * 这里只拦截"无论如何都不该由 Agent 执行"的系统级破坏操作。
 */

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

/**
 * 将用户/LLM 提供的路径解析为绝对路径，并确保其位于项目根目录内。
 * 越界（如 ../../、绝对路径指向系统目录）抛出 SecurityError。
 */
export function resolveWithinRoot(p: string, root: string = process.cwd()): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, p);
  const rel = path.relative(resolvedRoot, resolved);
  if (rel === '') return resolved; // 根目录本身
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new SecurityError(
      `Path "${p}" resolves outside the project root (${resolvedRoot}). ` +
      `Tools may only access files within the project directory.`
    );
  }
  return resolved;
}

interface CommandRule {
  pattern: RegExp;
  reason: string;
}

// 仅拦截毁灭性/系统级操作；常规开发命令一律放行（由 HITL 审批把关）
const BLOCKED_COMMAND_RULES: CommandRule[] = [
  { pattern: /\brm\s+(-[a-z]*[rf][a-z]*\s+)+([/\\]|~|\$home|%userprofile%|[a-z]:[/\\]?\s*$|[a-z]:[/\\](?:windows|users|program))/i, reason: 'recursive delete targeting system/root paths' },
  { pattern: /\brd\s+\/s(\s+\/q)?\s+[a-z]:[/\\]?(\s|$)/i, reason: 'recursive delete of a drive root' },
  { pattern: /\bdel\s+(\/[a-z]+\s+)*[a-z]:[/\\](windows|users|program)/i, reason: 'deleting system directories' },
  { pattern: /\bformat\s+[a-z]:/i, reason: 'formatting a drive' },
  { pattern: /\bmkfs(\.\w+)?\b/i, reason: 'creating a filesystem (destroys data)' },
  { pattern: /\bdd\s+[^|]*\bof=\/dev\//i, reason: 'raw write to a block device' },
  { pattern: /(curl|wget|irm|invoke-restmethod|invoke-webrequest)\b[^|;&]*[|;&]\s*(sh|bash|zsh|pwsh|powershell|iex|invoke-expression)\b/i, reason: 'piping remote content into a shell' },
  { pattern: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'shutting down or rebooting the machine' },
  { pattern: /\breg\s+delete\s+hk(lm|cu|cr|u|cc)/i, reason: 'deleting registry keys' },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\}\s*;/, reason: 'fork bomb' },
  { pattern: /\bgit\s+push\s+[^|;&]*--force(\s|$)/i, reason: 'force-pushing (requires explicit human action)' },
  { pattern: /\bchmod\s+(-[a-z]+\s+)*777\s+\//i, reason: 'world-writable permissions on root paths' },
];

/**
 * 检查终端命令是否命中危险黑名单。命中则抛出 SecurityError。
 */
export function assertCommandAllowed(command: string): void {
  const normalized = command.replace(/\s+/g, ' ').trim();
  for (const rule of BLOCKED_COMMAND_RULES) {
    if (rule.pattern.test(normalized)) {
      throw new SecurityError(
        `Command blocked by safety policy (${rule.reason}): ${normalized.substring(0, 120)}`
      );
    }
  }
}
