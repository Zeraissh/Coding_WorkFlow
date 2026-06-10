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
import type { AutoCheckResult, AgentExecutionLog, VerifierConfig } from './types';
export interface AutoCheckerDeps {
    /** 运行 shell 命令（如 eslint、tsc、npm test） */
    runShell: (command: string, cwd?: string) => Promise<{
        stdout: string;
        stderr: string;
        exitCode: number;
    }>;
    /** 读取文件内容 */
    readFile: (filePath: string) => Promise<string>;
    /** 检查文件是否存在 */
    fileExists: (filePath: string) => Promise<boolean>;
    /** 当前工作目录 */
    cwd: string;
}
export declare class AutoChecker {
    private config;
    private deps;
    constructor(deps: AutoCheckerDeps, config: VerifierConfig);
    /**
     * 执行所有自动化检查
     *
     * @param agentLogs Agent 执行日志
     * @returns 结构化的检查结果
     */
    check(agentLogs: AgentExecutionLog[]): Promise<AutoCheckResult>;
    /**
     * 检测多个 Agent 是否对同一文件进行了写入操作
     */
    private detectFileConflicts;
    /**
     * 检查跨文件的 import/export 一致性
     *
     * 包括：
     * - import 的目标文件是否存在
     * - import 的命名导出在目标文件中是否有对应的 export
     */
    private checkInterfaceConsistency;
    /**
     * 检查文件是否由 Agent 计划创建（通过 agentLogs 中的 write 操作）
     */
    private isFileCreatedByAgents;
    private runLintCheck;
    private runTypeCheck;
    private runTests;
    /**
     * 从源代码中解析 import 和 export 声明
     *
     * 使用正则表达式进行简化解析（不使用 AST），覆盖绝大多数常见写法。
     */
    private parseImportsExports;
    private parseNamedImportList;
    private deduplicateImports;
    private deduplicateExports;
    /**
     * 解析 import 路径到实际文件路径（尝试多种扩展名）
     * 返回 null 表示文件不存在
     */
    private resolveImportPath;
    /**
     * 将相对 import 路径解析为相对于 from 文件的绝对路径（项目相对路径）
     */
    private resolveRelativePath;
    /**
     * 解析 ESLint JSON 输出
     */
    private parseEslintOutput;
    /**
     * 解析 TypeScript 编译器输出
     *
     * 支持多种 tsc 输出格式：
     * - file.ts(line,col): error TS1234: message
     * - file.ts:line:col - error TS1234: message
     */
    private parseTscOutput;
    /**
     * 解析 Jest JSON 输出
     */
    private parseJestOutput;
    /**
     * 解析 Vitest JSON 输出
     */
    private parseVitestOutput;
    private findTestFiles;
}
//# sourceMappingURL=autoChecker.d.ts.map