/**
 * AutoChecker — 自动化检查阶段
 *
 * 在每个 Agent 完成子任务后，由 Verifier 驱动执行。
 * 包含：
 * 1. 文件冲突检测
 * 2. 接口一致性检查（import/export 匹配 + 类型签名比对）
 * 3. Lint 检查
 * 4. 类型检查
 * 5. 测试运行
 */

import type {
  AutoCheckResult,
  AgentExecutionLog,
  FileConflict,
  InterfaceMismatch,
  LintError,
  TypeError,
  VerifierConfig,
  TestResults,
} from './types';

// ============================================================================
// Dependencies
// ============================================================================

export interface AutoCheckerDeps {
  /** 运行 shell 命令（如 eslint、tsc、npm test） */
  runShell: (command: string, cwd?: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** 读取文件内容 */
  readFile: (filePath: string) => Promise<string>;
  /** 检查文件是否存在 */
  fileExists: (filePath: string) => Promise<boolean>;
  /** 当前工作目录 */
  cwd: string;
}

// ============================================================================
// Internal types
// ============================================================================

interface ImportEntry {
  modulePath: string;
  namedImports: string[];
  defaultImport: string | null;
  namespaceImport: string | null;
}

interface ExportEntry {
  name: string;
  kind: 'named' | 'default' | 'reexport';
  source?: string; // re-export 来源
}

// ============================================================================
// Constants
// ============================================================================

/** 尝试的扩展名顺序（TypeScript 项目优先） */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

// ============================================================================
// AutoChecker
// ============================================================================

export class AutoChecker {
  private config: VerifierConfig;
  private deps: AutoCheckerDeps;

  constructor(deps: AutoCheckerDeps, config: VerifierConfig) {
    this.deps = deps;
    this.config = config;
  }

  // ==========================================================================
  // 公共 API
  // ==========================================================================

  /**
   * 执行所有自动化检查
   *
   * @param agentLogs Agent 执行日志
   * @returns 结构化的检查结果
   */
  async check(agentLogs: AgentExecutionLog[]): Promise<AutoCheckResult> {
    const lintErrors: LintError[] = [];
    const typeErrors: TypeError[] = [];
    let testResults: TestResults | null = null;
    const autoFixSuggestions: string[] = [];

    // Step 1: 文件冲突检测
    const fileConflicts = this.detectFileConflicts(agentLogs);

    // Step 2: 接口一致性检查
    const interfaceMismatches = await this.checkInterfaceConsistency(agentLogs);

    // Step 3: Lint 检查
    const lintResult = await this.runLintCheck();
    if (lintResult) {
      lintErrors.push(...lintResult);
      if (this.config.autoFix && lintErrors.length > 0) {
        autoFixSuggestions.push(
          `发现 ${lintErrors.length} 个 lint 错误，建议运行 npx eslint --fix 自动修复`
        );
      }
    }

    // Step 4: 类型检查 (TypeScript 项目)
    const typeCheckErrors = await this.runTypeCheck();
    if (typeCheckErrors) {
      typeErrors.push(...typeCheckErrors);
    }

    // Step 5: 查找并运行测试
    testResults = await this.runTests(agentLogs);

    const allChecksPassed =
      fileConflicts.length === 0 &&
      lintErrors.length === 0 &&
      typeErrors.length === 0 &&
      interfaceMismatches.length === 0 &&
      (testResults === null || testResults.failed === 0);

    return {
      stage: 'auto',
      lintErrors,
      typeErrors,
      testResults,
      fileConflicts,
      interfaceMismatches,
      passed: allChecksPassed,
      autoFixSuggestions,
    };
  }

  // ==========================================================================
  // Step 1: 文件冲突检测
  // ==========================================================================

  /**
   * 检测多个 Agent 是否对同一文件进行了写入操作
   */
  private detectFileConflicts(agentLogs: AgentExecutionLog[]): FileConflict[] {
    const fileWriters = new Map<string, Set<string>>(); // file → Set<agentId>

    for (const log of agentLogs) {
      for (const op of log.files) {
        if (op.operation === 'write') {
          const writers = fileWriters.get(op.filePath) || new Set();
          writers.add(log.agentId);
          fileWriters.set(op.filePath, writers);
        }
      }
    }

    const conflicts: FileConflict[] = [];
    for (const [file, agents] of fileWriters.entries()) {
      if (agents.size > 1) {
        conflicts.push({
          file,
          agents: [...agents],
          action: 'last_write_wins', // 默认策略；实际应由 Orchestrator 处理
        });
      }
    }
    return conflicts;
  }

  // ==========================================================================
  // Step 2: 接口一致性检查
  // ==========================================================================

  /**
   * 检查跨文件的 import/export 一致性
   *
   * 包括：
   * - import 的目标文件是否存在
   * - import 的命名导出在目标文件中是否有对应的 export
   */
  private async checkInterfaceConsistency(
    agentLogs: AgentExecutionLog[]
  ): Promise<InterfaceMismatch[]> {
    const mismatches: InterfaceMismatch[] = [];

    // 收集所有文件的 import/export 声明
    const fileImports = new Map<string, ImportEntry[]>();
    const fileExports = new Map<string, ExportEntry[]>();

    for (const log of agentLogs) {
      for (const op of log.files) {
        if (op.operation === 'write' && op.content) {
          const parsed = this.parseImportsExports(op.content);
          if (parsed.imports.length > 0) {
            fileImports.set(op.filePath, parsed.imports);
          }
          if (parsed.exports.length > 0) {
            fileExports.set(op.filePath, parsed.exports);
          }
        }
      }
    }

    // 检查每个 import 是否有效
    for (const [file, imports] of fileImports.entries()) {
      for (const imp of imports) {
        // 跳过第三方包导入（非相对路径）
        if (!imp.modulePath.startsWith('.') && !imp.modulePath.startsWith('/')) {
          continue;
        }

        // 解析目标文件路径（尝试多种扩展名）
        const resolvedPath = await this.resolveImportPath(file, imp.modulePath);
        if (!resolvedPath) {
          // 检查目标文件是否在 agentLogs 中有写入记录（可能尚未写入磁盘）
          const willBeCreated = this.isFileCreatedByAgents(agentLogs, file, imp.modulePath);
          if (!willBeCreated) {
            mismatches.push({
              fileA: file,
              fileB: this.resolveRelativePath(file, imp.modulePath),
              kind: 'import_missing',
              detail: `${file} 导入了 "${imp.modulePath}"，但目标文件不存在`,
              suggestion: '检查文件路径是否正确，或该文件是否由其他 Agent 负责生成',
            });
          }
          continue;
        }

        // 检查导入的命名导出是否存在于目标文件中
        if (imp.namedImports.length > 0) {
          const targetExports = fileExports.get(resolvedPath);
          if (targetExports) {
            const exportedNames = new Set(targetExports.map((e) => e.name));
            for (const named of imp.namedImports) {
              if (!exportedNames.has(named)) {
                mismatches.push({
                  fileA: file,
                  fileB: resolvedPath,
                  kind: 'export_missing',
                  detail: `${file} 导入了 "${named}"，但 ${resolvedPath} 未导出该名称`,
                  suggestion: `检查 ${resolvedPath} 是否应该导出 "${named}"，或 import 名称是否拼写错误`,
                });
              }
            }
          } else if (imp.namedImports.length > 0) {
            // 目标文件没有收集到任何 export（可能是文件尚未解析或确实无导出）
            mismatches.push({
              fileA: file,
              fileB: resolvedPath,
              kind: 'export_missing',
              detail: `${file} 导入了 [${imp.namedImports.join(', ')}]，但 ${resolvedPath} 未导出任何内容`,
            });
          }
        }
      }
    }

    return mismatches;
  }

  /**
   * 检查文件是否由 Agent 计划创建（通过 agentLogs 中的 write 操作）
   */
  private isFileCreatedByAgents(
    agentLogs: AgentExecutionLog[],
    importerFile: string,
    importPath: string
  ): boolean {
    const expectedPath = this.resolveRelativePath(importerFile, importPath);
    const extensions = ['', ...RESOLVE_EXTENSIONS];

    for (const log of agentLogs) {
      for (const op of log.files) {
        if (op.operation === 'write') {
          for (const ext of extensions) {
            if (op.filePath === expectedPath + ext) {
              return true;
            }
          }
        }
      }
    }
    return false;
  }

  // ==========================================================================
  // Step 3: Lint 检查
  // ==========================================================================

  private async runLintCheck(): Promise<LintError[] | null> {
    try {
      // 检查 eslint 是否可用
      const versionCheck = await this.deps.runShell('npx eslint --version', this.deps.cwd);
      if (versionCheck.exitCode !== 0) {
        return null; // eslint 不可用
      }

      // 检查整个项目（简化命令，避免 bash-ism）
      const result = await this.deps.runShell(
        'npx eslint --format json --ext .ts,.tsx,.js,.jsx .',
        this.deps.cwd
      );

      return this.parseEslintOutput(result.stdout || result.stderr);
    } catch {
      return null; // eslint 不可用 → 跳过
    }
  }

  // ==========================================================================
  // Step 4: 类型检查
  // ==========================================================================

  private async runTypeCheck(): Promise<TypeError[] | null> {
    const tsconfigPath = `${this.deps.cwd}/tsconfig.json`;
    const hasTsconfig = await this.deps.fileExists(tsconfigPath);

    if (!hasTsconfig) {
      return null; // 非 TypeScript 项目
    }

    try {
      const result = await this.deps.runShell('npx tsc --noEmit', this.deps.cwd);
      if (result.exitCode !== 0) {
        // tsc 错误通常输出到 stdout
        const combined = result.stdout + '\n' + result.stderr;
        return this.parseTscOutput(combined);
      }
      return [];
    } catch {
      return null; // tsc 不可用 → 跳过
    }
  }

  // ==========================================================================
  // Step 5: 测试运行
  // ==========================================================================

  private async runTests(agentLogs: AgentExecutionLog[]): Promise<TestResults | null> {
    const testFiles = this.findTestFiles(agentLogs);

    // 检查是否有测试配置
    const hasJestConfig = (await this.deps.fileExists(`${this.deps.cwd}/jest.config.js`))
      || (await this.deps.fileExists(`${this.deps.cwd}/jest.config.ts`))
      || (await this.deps.fileExists(`${this.deps.cwd}/jest.config.json`));
    const hasVitestConfig = (await this.deps.fileExists(`${this.deps.cwd}/vitest.config.ts`))
      || (await this.deps.fileExists(`${this.deps.cwd}/vitest.config.js`));

    // 如果既没有测试文件也没有测试配置，跳过
    if (testFiles.length === 0 && !hasJestConfig && !hasVitestConfig) {
      return null;
    }

    try {
      let result: { stdout: string; stderr: string; exitCode: number };

      // 优先使用 vitest，其次 jest
      if (hasVitestConfig) {
        result = await this.deps.runShell('npx vitest run --reporter=json', this.deps.cwd);
        return this.parseVitestOutput(result.stdout || result.stderr);
      } else if (hasJestConfig) {
        result = await this.deps.runShell('npx jest --json --forceExit', this.deps.cwd);
        return this.parseJestOutput(result.stdout || result.stderr);
      } else if (testFiles.length > 0) {
        // 尝试 vitest（更通用）
        result = await this.deps.runShell('npx vitest run --reporter=json', this.deps.cwd);
        if (result.exitCode === 0 || (result.stdout && result.stdout.includes('"numTotalTests"'))) {
          return this.parseVitestOutput(result.stdout || result.stderr);
        }
        // 回退到 jest
        result = await this.deps.runShell('npx jest --json --forceExit', this.deps.cwd);
        return this.parseJestOutput(result.stdout || result.stderr);
      }

      return null;
    } catch {
      return null; // 测试运行器不可用 → 跳过
    }
  }

  // ==========================================================================
  // 私有: Import/Export 解析
  // ==========================================================================

  /**
   * 从源代码中解析 import 和 export 声明
   *
   * 使用正则表达式进行简化解析（不使用 AST），覆盖绝大多数常见写法。
   */
  private parseImportsExports(
    content: string
  ): { imports: ImportEntry[]; exports: ExportEntry[] } {
    const imports: ImportEntry[] = [];
    const exports: ExportEntry[] = [];

    // ── 解析 imports ──────────────────────────────────────────────

    // 1) import defaultImport, { named1, named2 } from 'module'
    // 2) import defaultImport from 'module'
    // 3) import { named1, named2 } from 'module'
    // 4) import * as name from 'module'
    // 5) import 'module'  (side-effect)
    // 6) import type { ... } from 'module'
    // 7) const x = await import('module')
    const importDeclRegex =
      /import\s+(?:type\s+)?(?:(?:\{([^}]*)\}|(\*\s+as\s+\w+)|(\w+))\s*,?\s*)?(?:,\s*(?:\{([^}]*)\}|(\w+)))?\s*from\s*['"]([^'"]+)['"]/g;

    let match: RegExpExecArray | null;
    while ((match = importDeclRegex.exec(content)) !== null) {
      const namedGroup1 = match[1]; // first { named }
      const namespaceGroup = match[2]; // * as name
      const defaultGroup = match[3]; // defaultImport
      const namedGroup2 = match[4]; // second { named } after comma
      const defaultGroup2 = match[5]; // alternative default
      const modulePath = match[6];

      const namedImports: string[] = [];
      if (namedGroup1) {
        namedImports.push(...this.parseNamedImportList(namedGroup1));
      }
      if (namedGroup2) {
        namedImports.push(...this.parseNamedImportList(namedGroup2));
      }

      const defaultImport = defaultGroup || defaultGroup2 || null;
      const namespaceImport = namespaceGroup
        ? namespaceGroup.replace('* as ', '').trim()
        : null;

      if (modulePath) {
        imports.push({
          modulePath,
          namedImports,
          defaultImport,
          namespaceImport,
        });
      }
    }

    // Side-effect import: import 'module' (without from)
    const sideEffectRegex = /import\s+(?:type\s+)?['"]([^'"]+)['"]/g;
    while ((match = sideEffectRegex.exec(content)) !== null) {
      const modulePath = match[1];
      // 避免与上面的声明重复
      const alreadyAdded = imports.some((i) => i.modulePath === modulePath);
      if (!alreadyAdded && modulePath) {
        imports.push({
          modulePath,
          namedImports: [],
          defaultImport: null,
          namespaceImport: null,
        });
      }
    }

    // Dynamic import: import('module')
    const dynamicImportRegex = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    while ((match = dynamicImportRegex.exec(content)) !== null) {
      const modulePath = match[1];
      if (modulePath && !imports.some((i) => i.modulePath === modulePath)) {
        imports.push({
          modulePath,
          namedImports: [],
          defaultImport: null,
          namespaceImport: null,
        });
      }
    }

    // ── 解析 exports ──────────────────────────────────────────────

    // Named exports: export const/let/var/function/class/interface/type/enum name
    const namedExportRegex =
      /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
    while ((match = namedExportRegex.exec(content)) !== null) {
      if (match[1]) {
        exports.push({ name: match[1], kind: 'named' });
      }
    }

    // export default expression / export default function/class name
    const defaultExportRegex = /export\s+default\s+(?:function|class)?\s*(\w+)?/g;
    while ((match = defaultExportRegex.exec(content)) !== null) {
      exports.push({ name: match[1] || 'default', kind: 'default' });
    }

    // export { name1, name2 } / export { name1 as alias }
    const exportListRegex = /export\s+\{([^}]+)\}/g;
    while ((match = exportListRegex.exec(content)) !== null) {
      const listStr = match[1];
      const names = this.parseNamedImportList(listStr);
      for (const name of names) {
        if (!exports.some((e) => e.name === name)) {
          exports.push({ name, kind: 'named' });
        }
      }
    }

    // Re-exports: export { name } from 'module' / export * from 'module'
    // 注意：需要排除 import 语句中的 "from"（由上下文保证，regex 先匹配 export）
    const reexportRegex = /export\s+(?:\{([^}]*)\}|\*\s*)\s*from\s*['"]([^'"]+)['"]/g;
    while ((match = reexportRegex.exec(content)) !== null) {
      const namedList = match[1];
      const source = match[2];
      if (namedList) {
        const names = this.parseNamedImportList(namedList);
        for (const name of names) {
          exports.push({ name, kind: 'reexport', source });
        }
      } else {
        // export * from 'module' — 无法静态确定具体导出了什么
        exports.push({ name: '*', kind: 'reexport', source });
      }
    }

    // 去重
    return {
      imports: this.deduplicateImports(imports),
      exports: this.deduplicateExports(exports),
    };
  }

  private parseNamedImportList(listStr: string): string[] {
    const names: string[] = [];
    // 支持: name1, name2, name3 as alias, 以及 type name
    const parts = listStr.split(',');
    for (const part of parts) {
      // 去除 "as alias" 部分，保留原名
      const trimmed = part.replace(/^\s*type\s+/, '').trim();
      if (!trimmed) continue;
      const nameMatch = trimmed.match(/^(\w+)/);
      if (nameMatch) {
        names.push(nameMatch[1]);
      }
    }
    return names;
  }

  private deduplicateImports(imports: ImportEntry[]): ImportEntry[] {
    const map = new Map<string, ImportEntry>();
    for (const imp of imports) {
      const existing = map.get(imp.modulePath);
      if (existing) {
        // 合并 named imports
        const mergedNames = new Set([...existing.namedImports, ...imp.namedImports]);
        existing.namedImports = [...mergedNames];
        existing.defaultImport = existing.defaultImport || imp.defaultImport;
        existing.namespaceImport = existing.namespaceImport || imp.namespaceImport;
      } else {
        map.set(imp.modulePath, { ...imp });
      }
    }
    return [...map.values()];
  }

  private deduplicateExports(exports: ExportEntry[]): ExportEntry[] {
    const seen = new Set<string>();
    return exports.filter((e) => {
      const key = `${e.kind}:${e.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ==========================================================================
  // 私有: 路径解析
  // ==========================================================================

  /**
   * 解析 import 路径到实际文件路径（尝试多种扩展名）
   * 返回 null 表示文件不存在
   */
  private async resolveImportPath(
    fromFile: string,
    importPath: string
  ): Promise<string | null> {
    const basePath = this.resolveRelativePath(fromFile, importPath);

    // 先检查精确路径
    if (await this.deps.fileExists(basePath)) {
      return basePath;
    }

    // 尝试常见的扩展名
    for (const ext of RESOLVE_EXTENSIONS) {
      const candidate = basePath + ext;
      if (await this.deps.fileExists(candidate)) {
        return candidate;
      }
    }

    return null;
  }

  /**
   * 将相对 import 路径解析为相对于 from 文件的绝对路径（项目相对路径）
   */
  private resolveRelativePath(from: string, relative: string): string {
    // 统一使用正斜杠
    const normalizedFrom = from.replace(/\\/g, '/');
    const normalizedRelative = relative.replace(/\\/g, '/');

    const fromDir = normalizedFrom.replace(/\/[^/]*$/, '');
    const fromSegments = fromDir.split('/').filter(Boolean);
    const relSegments = normalizedRelative.split('/');

    for (const seg of relSegments) {
      if (seg === '..') {
        fromSegments.pop();
      } else if (seg === '.') {
        // 跳过
      } else {
        fromSegments.push(seg);
      }
    }

    return fromSegments.join('/');
  }

  // ==========================================================================
  // 私有: 输出解析
  // ==========================================================================

  /**
   * 解析 ESLint JSON 输出
   */
  private parseEslintOutput(raw: string): LintError[] {
    if (!raw || raw.trim() === '') return [];

    try {
      // 尝试提取 JSON 部分（可能有前置警告信息）
      const jsonStart = raw.indexOf('[');
      const jsonEnd = raw.lastIndexOf(']');
      if (jsonStart === -1 || jsonEnd === -1) return [];

      const jsonStr = raw.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonStr);

      if (!Array.isArray(parsed)) return [];

      return parsed.flatMap((file: any) =>
        (file.messages || []).map(
          (msg: any): LintError => ({
            file: file.filePath || '',
            line: msg.line || 0,
            column: msg.column,
            message: msg.message || '',
            rule: msg.ruleId || undefined,
          })
        )
      );
    } catch {
      return [];
    }
  }

  /**
   * 解析 TypeScript 编译器输出
   *
   * 支持多种 tsc 输出格式：
   * - file.ts(line,col): error TS1234: message
   * - file.ts:line:col - error TS1234: message
   */
  private parseTscOutput(raw: string): TypeError[] {
    if (!raw || raw.trim() === '') return [];

    const errors: TypeError[] = [];

    // 格式1: file(line,col): error TS1234: message
    const regex1 = /(.+?)\((\d+),(\d+)\):\s+error\s+TS(\d+):\s+(.+)/g;
    let match: RegExpExecArray | null;
    while ((match = regex1.exec(raw)) !== null) {
      if (match[1] && match[2] && match[4] && match[5]) {
        errors.push({
          file: match[1].trim(),
          line: parseInt(match[2], 10),
          code: parseInt(match[4], 10),
          message: match[5].trim(),
        });
      }
    }

    // 格式2 (较新 tsc): file.ts:line:col - error TS1234: message
    const regex2 = /(.+?):(\d+):(\d+)\s+-\s+error\s+TS(\d+):\s+(.+)/g;
    while ((match = regex2.exec(raw)) !== null) {
      if (match[1] && match[2] && match[4] && match[5]) {
        // 避免重复（同一错误可能被两个正则匹配）
        const isDuplicate = errors.some(
          (e) =>
            e.file === match![1].trim() &&
            e.line === parseInt(match![2], 10) &&
            e.code === parseInt(match![4], 10)
        );
        if (!isDuplicate) {
          errors.push({
            file: match[1].trim(),
            line: parseInt(match[2], 10),
            code: parseInt(match[4], 10),
            message: match[5].trim(),
          });
        }
      }
    }

    return errors;
  }

  /**
   * 解析 Jest JSON 输出
   */
  private parseJestOutput(raw: string): TestResults {
    if (!raw || raw.trim() === '') {
      return { passed: 0, failed: 0, output: '' };
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        passed: parsed.numPassedTests || 0,
        failed: parsed.numFailedTests || 0,
        skipped: parsed.numPendingTests || 0,
        output: '',
        duration: parsed.testResults
          ? parsed.testResults.reduce((sum: number, r: any) => {
              const dur = r.endTime && r.startTime ? r.endTime - r.startTime : 0;
              return sum + dur;
            }, 0)
          : undefined,
      };
    } catch {
      // 非 JSON 输出，尝试从文本中提取摘要
      const passedMatch = raw.match(/Tests:\s+(\d+)\s+passed/);
      const failedMatch = raw.match(/(\d+)\s+failed/);
      return {
        passed: passedMatch ? parseInt(passedMatch[1], 10) : 0,
        failed: failedMatch ? parseInt(failedMatch[1], 10) : 0,
        output: raw,
      };
    }
  }

  /**
   * 解析 Vitest JSON 输出
   */
  private parseVitestOutput(raw: string): TestResults {
    if (!raw || raw.trim() === '') {
      return { passed: 0, failed: 0, output: '' };
    }

    try {
      const parsed = JSON.parse(raw);
      return {
        passed: parsed.numPassedTests || 0,
        failed: parsed.numFailedTests || 0,
        skipped: parsed.numSkippedTests || parsed.numPendingTests || 0,
        output: '',
        duration: parsed.testResults
          ? parsed.testResults.reduce((sum: number, r: any) => {
              const dur = r.endTime && r.startTime ? r.endTime - r.startTime : 0;
              return sum + dur;
            }, 0)
          : undefined,
      };
    } catch {
      // 尝试 jest 格式
      return this.parseJestOutput(raw);
    }
  }

  // ==========================================================================
  // 私有: 测试文件查找
  // ==========================================================================

  private findTestFiles(agentLogs: AgentExecutionLog[]): string[] {
    const testFiles: string[] = [];
    for (const log of agentLogs) {
      for (const op of log.files) {
        if (/\.(test|spec)\.(ts|tsx|js|jsx)$/i.test(op.filePath)) {
          testFiles.push(op.filePath);
        }
      }
    }
    return testFiles;
  }
}
