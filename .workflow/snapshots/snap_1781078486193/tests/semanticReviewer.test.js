/**
 * SemanticReviewer 单元测试
 * 测试解析逻辑、prompt 构建、维度定义等
 */
import { describe, it, expect } from 'vitest';
import { SemanticReviewer, generateSummary } from '../src/core/verifier/semanticReviewer';
// 辅助：创建一个 mock 的 SemanticReviewer 实例用于测试内部逻辑
function createReviewer(config) {
    const defaultConfig = {
        autoCheck: true,
        semanticReview: true,
        autoFix: false,
        ...config,
    };
    return new SemanticReviewer({
        callLLM: async () => '[]',
    }, defaultConfig);
}
describe('SemanticReviewer', () => {
    describe('review - empty inputs', () => {
        it('should return empty array when semanticReview is disabled', async () => {
            const reviewer = createReviewer({ semanticReview: false });
            const result = await reviewer.review([]);
            expect(result).toEqual([]);
        });
        it('should return empty array when no agent logs', async () => {
            const reviewer = createReviewer();
            const result = await reviewer.review([]);
            expect(result).toEqual([]);
        });
        it('should return empty array when agent logs have no write operations', async () => {
            const reviewer = createReviewer();
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [{ agentId: 'agent-1', subtaskId: 'task-1', operation: 'read', filePath: 'test.ts', timestamp: 0 }],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const result = await reviewer.review(logs);
            expect(result).toEqual([]);
        });
    });
    describe('review - mock LLM response parsing', () => {
        it('should parse valid JSON response correctly', async () => {
            const mockResponse = JSON.stringify([
                {
                    severity: 'critical',
                    file: 'src/test.ts',
                    line: 10,
                    category: 'logic',
                    description: '缺少空值检查',
                    suggestion: '添加判空逻辑',
                },
                {
                    severity: 'warning',
                    file: 'src/test2.ts',
                    category: 'style',
                    description: '命名不一致',
                    suggestion: '统一使用 camelCase',
                },
            ]);
            const reviewer = new SemanticReviewer({ callLLM: async () => mockResponse }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'src/test.ts',
                            content: 'function test() { return null; }',
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const result = await reviewer.review(logs);
            expect(result).toHaveLength(2);
            expect(result[0].severity).toBe('critical');
            expect(result[0].category).toBe('logic');
            expect(result[0].file).toBe('src/test.ts');
            expect(result[0].line).toBe(10);
            expect(result[0].description).toBe('缺少空值检查');
            expect(result[1].severity).toBe('warning');
            expect(result[1].category).toBe('style');
        });
        it('should parse JSON wrapped in markdown code block', async () => {
            const mockResponse = '```json\n[\n  {\n    "severity": "warning",\n    "file": "a.ts",\n    "description": "test",\n    "suggestion": "fix"\n  }\n]\n```';
            const reviewer = new SemanticReviewer({ callLLM: async () => mockResponse }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'a.ts',
                            content: 'code',
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const result = await reviewer.review(logs);
            expect(result).toHaveLength(1);
            expect(result[0].file).toBe('a.ts');
        });
        it('should return empty array on invalid JSON', async () => {
            const reviewer = new SemanticReviewer({ callLLM: async () => 'not valid json at all' }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'a.ts',
                            content: 'code',
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const result = await reviewer.review(logs);
            expect(result).toEqual([]);
        });
        it('should return empty array on LLM call failure', async () => {
            const reviewer = new SemanticReviewer({ callLLM: async () => { throw new Error('API Error'); } }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'a.ts',
                            content: 'code',
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const result = await reviewer.review(logs);
            expect(result).toEqual([]);
        });
        it('should filter out items missing required fields (file & description)', async () => {
            const mockResponse = JSON.stringify([
                { severity: 'warning', file: 'a.ts', description: 'valid' },
                { severity: 'warning', description: 'missing file' },
                { severity: 'critical', file: 'c.ts' }, // missing description
            ]);
            const reviewer = new SemanticReviewer({ callLLM: async () => mockResponse }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'a.ts',
                            content: 'code',
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const result = await reviewer.review(logs);
            // Only the first item has both file and description
            expect(result).toHaveLength(1);
            expect(result[0].file).toBe('a.ts');
        });
        it('should default invalid severity to warning and invalid category to logic', async () => {
            const mockResponse = JSON.stringify([
                {
                    severity: 'unknown_severity',
                    file: 'test.ts',
                    description: 'test',
                    category: 'unknown_category',
                    suggestion: 'fix',
                },
            ]);
            const reviewer = new SemanticReviewer({ callLLM: async () => mockResponse }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'test.ts',
                            content: 'code',
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const result = await reviewer.review(logs);
            expect(result[0].severity).toBe('warning');
            expect(result[0].category).toBe('logic');
        });
    });
    describe('file truncation', () => {
        it('should truncate files longer than 200 lines', async () => {
            const longContent = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n');
            let capturedPrompt = '';
            const reviewer = new SemanticReviewer({
                callLLM: async (prompt) => {
                    capturedPrompt = prompt;
                    return '[]';
                },
            }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'long.ts',
                            content: longContent,
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            await reviewer.review(logs);
            expect(capturedPrompt).toContain('line 200');
            expect(capturedPrompt).toContain('100 more lines');
            expect(capturedPrompt).not.toContain('line 300');
        });
    });
    describe('prompt includes autoCheck results when provided', () => {
        it('should include autoCheck summary in prompt', async () => {
            let capturedPrompt = '';
            const reviewer = new SemanticReviewer({
                callLLM: async (prompt) => {
                    capturedPrompt = prompt;
                    return '[]';
                },
            }, { autoCheck: true, semanticReview: true, autoFix: false });
            const logs = [
                {
                    agentId: 'agent-1',
                    subtaskId: 'task-1',
                    files: [
                        {
                            agentId: 'agent-1',
                            subtaskId: 'task-1',
                            operation: 'write',
                            filePath: 'test.ts',
                            content: 'code',
                            timestamp: 0,
                        },
                    ],
                    shellCommands: [],
                    llmCalls: 0,
                    tokensUsed: 0,
                    errors: [],
                },
            ];
            const autoCheck = {
                stage: 'auto',
                lintErrors: [{ file: 'test.ts', line: 1, message: 'no-console' }],
                typeErrors: [],
                testResults: null,
                fileConflicts: [],
                interfaceMismatches: [],
                passed: false,
                autoFixSuggestions: [],
            };
            await reviewer.review(logs, autoCheck);
            expect(capturedPrompt).toContain('Lint 错误: 1 个');
            expect(capturedPrompt).toContain('存在问题');
        });
    });
});
describe('generateSummary', () => {
    const baseAutoCheck = {
        stage: 'auto',
        lintErrors: [],
        typeErrors: [],
        testResults: null,
        fileConflicts: [],
        interfaceMismatches: [],
        passed: true,
        autoFixSuggestions: [],
    };
    it('should generate pass summary when all checks pass', () => {
        const summary = generateSummary(baseAutoCheck, [], 1500);
        expect(summary).toContain('PASS');
        expect(summary).toContain('1.5s');
        expect(summary).toContain('未发现语义问题');
    });
    it('should generate fail summary when autoCheck fails', () => {
        const autoCheck = { ...baseAutoCheck, passed: false };
        const summary = generateSummary(autoCheck, [], 1000);
        expect(summary).toContain('FAIL');
    });
    it('should generate fail summary when critical semantic issues exist', () => {
        const issues = [
            {
                severity: 'critical',
                file: 'test.ts',
                description: '严重逻辑错误',
                suggestion: '需要重写',
                category: 'logic',
            },
        ];
        const summary = generateSummary(baseAutoCheck, issues, 1000);
        expect(summary).toContain('FAIL');
        expect(summary).toContain('严重逻辑错误');
    });
    it('should generate pass_with_warnings when only warnings exist', () => {
        const issues = [
            {
                severity: 'warning',
                file: 'test.ts',
                description: '风格问题',
                suggestion: '修改',
                category: 'style',
            },
        ];
        const summary = generateSummary(baseAutoCheck, issues, 1000);
        expect(summary).toContain('PASS WITH WARNINGS');
    });
    it('should include test results when available', () => {
        const autoCheck = {
            ...baseAutoCheck,
            testResults: { passed: 10, failed: 2, output: '' },
        };
        const summary = generateSummary(autoCheck, [], 1000);
        expect(summary).toContain('10P');
        expect(summary).toContain('2F');
    });
});
//# sourceMappingURL=semanticReviewer.test.js.map