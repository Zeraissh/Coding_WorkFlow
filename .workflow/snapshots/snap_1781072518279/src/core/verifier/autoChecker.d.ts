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
    check(agentLogs: AgentExecutionLog[]): Promise<AutoCheckResult>;
    private detectFileConflicts;
    private checkInterfaceConsistency;
    private parseImportsExports;
    private resolveRelativePath;
    private ensureExtension;
    private parseEslintOutput;
    private parseTscOutput;
    private parseTestOutput;
    private findTestFiles;
}
//# sourceMappingURL=autoChecker.d.ts.map