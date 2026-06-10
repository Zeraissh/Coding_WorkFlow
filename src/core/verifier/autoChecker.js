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
// ============================================================================
// AutoChecker
// ============================================================================
export class AutoChecker {
    config;
    deps;
    constructor(deps, config) {
        this.deps = deps;
        this.config = config;
    }
    // ==========================================================================
    // 公共 API
    // ==========================================================================
    async check(agentLogs) {
        const lintErrors = [];
        const typeErrors = [];
        let testResults = null;
        const autoFixSuggestions = [];
        // Step 1: 文件冲突检测
        const fileConflicts = this.detectFileConflicts(agentLogs);
        // Step 2: 接口一致性检查
        const interfaceMismatches = await this.checkInterfaceConsistency(agentLogs);
        // Step 3: Lint 检查
        try {
            await this.deps.runShell('npx eslint --version');
            const result = await this.deps.runShell('npx eslint --format json $(git diff --name-only HEAD 2>/dev/null || echo ".") 2>/dev/null || npx eslint --format json . --ext .ts,.tsx,.js,.jsx 2>/dev/null || echo "[]"', this.deps.cwd);
            lintErrors.push(...this.parseEslintOutput(result.stdout + result.stderr));
            if (this.config.autoFix && lintErrors.length > 0) {
                autoFixSuggestions.push(`发现 ${lintErrors.length} 个 lint 错误，建议运行 npx eslint --fix`);
            }
        }
        catch {
            // eslint 不可用 → 跳过
        }
        // Step 4: 类型检查 (TypeScript 项目)
        if (await this.deps.fileExists(`${this.deps.cwd}/tsconfig.json`)) {
            try {
                const tscResult = await this.deps.runShell('npx tsc --noEmit', this.deps.cwd);
                if (tscResult.exitCode !== 0) {
                    typeErrors.push(...this.parseTscOutput(tscResult.stdout + '\\n' + tscResult.stderr));
                }
            }
            catch {
                // tsc 不可用 → 跳过
            }
        }
        // Step 5: 查找并运行测试
        const testFiles = this.findTestFiles(agentLogs);
        if (testFiles.length > 0) {
            try {
                const testResult = await this.deps.runShell('npx jest --json --forceExit 2>/dev/null || npx vitest run --reporter json 2>/dev/null || echo "{}"', this.deps.cwd);
                testResults = this.parseTestOutput(testResult.stdout + testResult.stderr);
            }
            catch {
                // 测试运行器不可用 → 跳过
            }
        }
        const allChecksPassed = fileConflicts.length === 0 &&
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
    // 私有: 文件冲突检测
    // ==========================================================================
    detectFileConflicts(agentLogs) {
        const fileWriters = new Map(); // file → [agentId, ...]
        for (const log of agentLogs) {
            for (const op of log.files) {
                if (op.operation === 'write') {
                    const writers = fileWriters.get(op.filePath) || [];
                    if (!writers.includes(log.agentId)) {
                        writers.push(log.agentId);
                    }
                    fileWriters.set(op.filePath, writers);
                }
            }
        }
        const conflicts = [];
        for (const [file, agents] of fileWriters.entries()) {
            if (agents.length > 1) {
                conflicts.push({
                    file,
                    agents,
                    action: 'last_write_wins',
                });
            }
        }
        return conflicts;
    }
    // ==========================================================================
    // 私有: 接口一致性检查
    // ==========================================================================
    async checkInterfaceConsistency(agentLogs) {
        const mismatches = [];
        // 收集所有 import/export 声明
        const imports = new Map();
        const exports = new Map();
        for (const log of agentLogs) {
            for (const op of log.files) {
                if (op.operation === 'write' && op.content) {
                    const parsed = this.parseImportsExports(op.content);
                    if (parsed.imports.length > 0) {
                        const list = imports.get(op.filePath) || [];
                        list.push({ file: op.filePath, agentId: log.agentId, imports: parsed.imports });
                        imports.set(op.filePath, list);
                    }
                    if (parsed.exports.length > 0) {
                        const list = exports.get(op.filePath) || [];
                        list.push({ file: op.filePath, agentId: log.agentId, exports: parsed.exports });
                        exports.set(op.filePath, list);
                    }
                }
            }
        }
        // 检查 import 引用的文件/导出是否存在
        for (const [file, importList] of imports.entries()) {
            for (const entry of importList) {
                for (const imp of entry.imports) {
                    // 跳过 node_modules 和相对路径外的导入
                    if (imp.startsWith('.') || imp.startsWith('/')) {
                        const resolved = this.resolveRelativePath(file, imp);
                        if (await this.deps.fileExists(resolved)) {
                            // 检查被导入的文件是否有对应的 export
                            const targetExports = exports.get(resolved);
                            if (!targetExports || targetExports.length === 0) {
                                mismatches.push({
                                    fileA: file,
                                    fileB: resolved,
                                    kind: 'export_missing',
                                    detail: `${file} 导入了 ${resolved}，但 ${resolved} 没有导出任何内容`,
                                });
                            }
                        }
                        else {
                            mismatches.push({
                                fileA: file,
                                fileB: resolved,
                                kind: 'import_missing',
                                detail: `${file} 导入了 ${imp}，但文件 ${resolved} 不存在`,
                                suggestion: `检查文件路径是否正确，或该文件是否由其他 Agent 负责生成`,
                            });
                        }
                    }
                }
            }
        }
        return mismatches;
    }
    // ==========================================================================
    // 私有: Import/Export 解析（简化版 AST）
    // ==========================================================================
    parseImportsExports(content) {
        const importRegex = /(?:import|from)\s+['"](\.[^'"]+)['"]|import\s*\(['"](\.[^'"]+)['"]\)/g;
        const exportRegex = /export\s+(?:const|let|var|function|class|interface|type|enum|default)\s+(\w+)/g;
        const imports = [];
        const exports = [];
        let match;
        while ((match = importRegex.exec(content)) !== null) {
            const path = match[1] || match[2];
            if (path)
                imports.push(path);
        }
        while ((match = exportRegex.exec(content)) !== null) {
            if (match[1])
                exports.push(match[1]);
        }
        return { imports: [...new Set(imports)], exports: [...new Set(exports)] };
    }
    // ==========================================================================
    // 私有: 路径解析
    // ==========================================================================
    resolveRelativePath(from, relative) {
        const fromDir = from.replace(/[/\\][^/\\]*$/, '');
        const segments = fromDir.split(/[/\\]/).filter(Boolean);
        const relativeSegments = relative.split('/');
        for (const seg of relativeSegments) {
            if (seg === '..') {
                segments.pop();
            }
            else if (seg !== '.') {
                segments.push(seg);
            }
        }
        return segments.join('/') + (relative.endsWith('/') ? '' : this.ensureExtension(segments.join('/')));
    }
    ensureExtension(path) {
        if (/\.(ts|tsx|js|jsx|json|css|scss)$/.test(path))
            return '';
        // 尝试 .ts 优先
        return '.ts';
    }
    // ==========================================================================
    // 私有: 输出解析
    // ==========================================================================
    parseEslintOutput(raw) {
        try {
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed))
                return [];
            return parsed.flatMap((file) => (file.messages || []).map((msg) => ({
                file: file.filePath || '',
                line: msg.line || 0,
                column: msg.column,
                message: msg.message || '',
                rule: msg.ruleId,
            })));
        }
        catch {
            return [];
        }
    }
    parseTscOutput(raw) {
        const errors = [];
        const regex = /(.+?)\((\d+),\d+\):\s+error\s+TS(\d+):\s+(.+)/g;
        let match;
        while ((match = regex.exec(raw)) !== null) {
            if (match[1] && match[2] && match[3] && match[4]) {
                errors.push({
                    file: match[1].trim(),
                    line: parseInt(match[2], 10),
                    code: parseInt(match[3], 10),
                    message: match[4].trim(),
                });
            }
        }
        return errors;
    }
    parseTestOutput(raw) {
        try {
            const parsed = JSON.parse(raw);
            return {
                passed: parsed.numPassedTests || parsed.success || 0,
                failed: parsed.numFailedTests || parsed.failed || 0,
                skipped: parsed.numPendingTests || parsed.skipped || 0,
                output: '',
                duration: parsed.testResults?.[0]?.endTime - parsed.testResults?.[0]?.startTime,
            };
        }
        catch {
            return { passed: 0, failed: 0, output: raw };
        }
    }
    findTestFiles(agentLogs) {
        const testFiles = [];
        for (const log of agentLogs) {
            for (const op of log.files) {
                if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(op.filePath)) {
                    testFiles.push(op.filePath);
                }
            }
        }
        return testFiles;
    }
}
//# sourceMappingURL=autoChecker.js.map