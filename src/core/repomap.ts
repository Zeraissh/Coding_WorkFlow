/**
 * RepoMap — 仓库符号地图（对标 Aider 的 repo map）
 *
 * 用轻量正则提取各语言的顶层符号（类/函数/导出），渲染成紧凑的
 * "文件 → 符号列表" 地图注入规划上下文——比纯目录树信息密度高一个量级，
 * 让 decomposer 知道"哪个文件里有什么"，而不只是"有哪些文件"。
 *
 * 设计取舍：正则而非 tree-sitter——零原生依赖、确定性、可测试；
 * 覆盖 80% 场景（顶层声明），不追求语法树级精度。
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileSymbols {
  /** 相对路径（posix 风格） */
  file: string;
  symbols: string[];
}

export interface RepoMapConfig {
  /** 输出地图的最大字符数（超出按文件截断） */
  maxChars: number;
  /** 单文件最多列出的符号数 */
  maxSymbolsPerFile: number;
  /** 扫描的最大文件数 */
  maxFiles: number;
}

const DEFAULT_CONFIG: RepoMapConfig = {
  maxChars: 4000,
  maxSymbolsPerFile: 12,
  maxFiles: 200,
};

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'coverage',
  'venv', '.venv', '__pycache__', '.next', '.cache', '.workflow',
]);

interface LangSpec {
  exts: string[];
  patterns: RegExp[];
}

// 每个 pattern 的第一个捕获组 = 符号名
const LANG_SPECS: LangSpec[] = [
  {
    exts: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    patterns: [
      /^export\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
      /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
      /^export\s+(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
      /^(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
    ],
  },
  {
    exts: ['.py'],
    patterns: [
      /^class\s+([A-Za-z_]\w*)/,
      /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
    ],
  },
  {
    exts: ['.go'],
    patterns: [
      /^func\s+(?:\([^)]*\)\s+)?([A-Za-z_]\w*)/,
      /^type\s+([A-Za-z_]\w*)\s+(?:struct|interface)/,
    ],
  },
  {
    exts: ['.java', '.cs'],
    patterns: [
      /^\s*(?:public|private|protected|internal)?\s*(?:static\s+)?(?:abstract\s+)?(?:partial\s+)?(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/,
    ],
  },
  {
    exts: ['.c', '.cpp', '.h', '.hpp'],
    patterns: [
      /^(?:[A-Za-z_][\w<>:*&\s]*\s+)?([A-Za-z_]\w*)\s*\([^;]*\)\s*\{?\s*$/,
      /^(?:typedef\s+)?(?:struct|class|enum)\s+([A-Za-z_]\w*)/,
    ],
  },
  {
    exts: ['.rs'],
    patterns: [
      /^(?:pub\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/,
      /^(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/,
    ],
  },
];

const EXT_TO_SPEC = new Map<string, LangSpec>();
for (const spec of LANG_SPECS) {
  for (const ext of spec.exts) EXT_TO_SPEC.set(ext, spec);
}

/** 从单个文件内容提取符号 */
export function extractSymbols(content: string, ext: string, maxSymbols: number = 12): string[] {
  const spec = EXT_TO_SPEC.get(ext);
  if (!spec) return [];

  const symbols: string[] = [];
  const seen = new Set<string>();
  for (const line of content.split('\n')) {
    if (symbols.length >= maxSymbols) break;
    const trimmed = line.trimEnd();
    for (const pattern of spec.patterns) {
      const m = trimmed.match(pattern);
      if (m && m[1] && !seen.has(m[1])) {
        seen.add(m[1]);
        symbols.push(m[1]);
        break;
      }
    }
  }
  return symbols;
}

export class RepoMap {
  private cwd: string;
  private config: RepoMapConfig;

  constructor(cwd: string = process.cwd(), config?: Partial<RepoMapConfig>) {
    this.cwd = cwd;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  private walk(dir: string, files: string[]): void {
    if (files.length >= this.config.maxFiles) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= this.config.maxFiles) return;
      if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        this.walk(fullPath, files);
      } else if (EXT_TO_SPEC.has(path.extname(entry.name))) {
        files.push(fullPath);
      }
    }
  }

  scan(): FileSymbols[] {
    const files: string[] = [];
    this.walk(this.cwd, files);

    const results: FileSymbols[] = [];
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const symbols = extractSymbols(content, path.extname(file), this.config.maxSymbolsPerFile);
        if (symbols.length > 0) {
          results.push({
            file: path.relative(this.cwd, file).replace(/\\/g, '/'),
            symbols,
          });
        }
      } catch {
        // 不可读文件跳过
      }
    }
    return results;
  }

  /** 渲染紧凑地图，超出 maxChars 截断并标注 */
  render(): string {
    const entries = this.scan();
    if (entries.length === 0) return '';

    const lines: string[] = [];
    let chars = 0;
    let truncated = false;
    for (const e of entries) {
      const line = `${e.file}: ${e.symbols.join(', ')}`;
      if (chars + line.length > this.config.maxChars) {
        truncated = true;
        break;
      }
      lines.push(line);
      chars += line.length + 1;
    }
    if (truncated) lines.push(`... (${entries.length - lines.length} more files omitted)`);
    return lines.join('\n');
  }
}
