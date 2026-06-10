/**
 * Decomposer — 智能任务拆解引擎
 *
 * 核心流程：
 * 1. 分类用户输入 → 匹配 few-shot 模板
 * 2. LLM 拆解（结构化 JSON 输出）
 * 3. 自检（可选）→ 修复隐式依赖和文件冲突
 * 4. 拓扑排序 → 输出并行批次
 */
import { DEFAULT_DECOMPOSER_CONFIG } from './types';
import { detectCategory, buildDecompositionPrompt, buildSelfCheckPrompt, } from './templates';
// ============================================================================
// Decomposer
// ============================================================================
export class Decomposer {
    config;
    llm;
    constructor(llm, config) {
        this.llm = llm;
        this.config = { ...DEFAULT_DECOMPOSER_CONFIG, ...config };
    }
    updateConfig(config) {
        this.config = { ...this.config, ...config };
    }
    // ==========================================================================
    // 公共 API
    // ==========================================================================
    /**
     * 将用户任务分解为子任务
     *
     * @param userInput 用户的自然语言任务描述
     * @param projectMemory 项目的长期记忆上下文
     * @returns 拆解结果（含并行批次）
     */
    async decompose(userInput, projectMemory = '') {
        const warnings = [];
        // Step 1: 分类
        const category = this.config.fewShotCategory === 'auto'
            ? detectCategory(userInput)
            : this.config.fewShotCategory;
        // Step 2: LLM 拆解 (with 1 retry)
        let subtasks = [];
        let prompt = buildDecompositionPrompt(userInput, category, this.config, projectMemory);
        for (let attempt = 1; attempt <= 2; attempt++) {
            const rawResponse = await this.llm.callLLM(prompt, {
                temperature: 0.3,
                maxTokens: 4000,
            });
            subtasks = this.parseSubtasks(rawResponse);
            if (subtasks.length > 0) {
                break; // 成功解析
            }
            // 失败则添加错误提示重新试
            prompt += `\n\nERROR: The previous response was not a valid JSON array of Subtasks. Please ensure your response is strictly a JSON array of objects fitting the schema, enclosed in \`\`\`json blocks. Do not return empty.`;
            warnings.push(`LLM 拆解 JSON 解析失败，正在进行第 ${attempt} 次重试...`);
        }
        if (subtasks.length === 0) {
            warnings.push('LLM 拆解彻底失败，使用分析与执行双任务兜底模板');
            subtasks = this.createFallbackTasks(userInput);
        }
        // 限制数量
        if (subtasks.length > this.config.maxSubtasks) {
            warnings.push(`子任务数量 ${subtasks.length} 超过上限 ${this.config.maxSubtasks}，已截断`);
            subtasks = subtasks.slice(0, this.config.maxSubtasks);
        }
        // Step 3: 自检（可选）
        if (this.config.enableSelfCheck) {
            const selfCheckResult = await this.selfCheck(subtasks);
            subtasks = this.applySelfCheck(subtasks, selfCheckResult);
            warnings.push(...selfCheckResult.warnings);
        }
        // Step 4: 构建 DAG + 拓扑排序
        const dependencyGraph = this.buildDependencyGraph(subtasks);
        const parallelBatches = this.topoSortBatches(subtasks, dependencyGraph);
        // 验证 DAG 无环
        if (!this.isAcyclic(subtasks, dependencyGraph)) {
            warnings.push('检测到循环依赖！已退化为顺序执行');
            return {
                subtasks,
                dependencyGraph,
                parallelBatches: subtasks.map((t) => [t]), // 逐个执行
                warnings,
            };
        }
        return {
            subtasks,
            dependencyGraph,
            parallelBatches,
            warnings,
        };
    }
    // ==========================================================================
    // 私有方法
    // ==========================================================================
    /**
     * 从 LLM 返回文本中解析 JSON
     */
    parseSubtasks(raw) {
        // 尝试直接解析
        let json;
        // 先尝试从 ```json 代码块提取
        const jsonBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
        const jsonStr = (jsonBlockMatch?.[1] ?? raw).trim();
        try {
            json = JSON.parse(jsonStr);
        }
        catch {
            // 尝试修复常见问题：单引号 → 双引号
            try {
                json = JSON.parse(jsonStr.replace(/'/g, '"'));
            }
            catch {
                return [];
            }
        }
        if (!Array.isArray(json))
            return [];
        return json
            .filter((item) => typeof item === 'object' && item !== null)
            .map((item) => this.normalizeSubtask(item))
            .filter((t) => t !== null);
    }
    normalizeSubtask(item) {
        if (!item.id || !item.description)
            return null;
        return {
            id: String(item.id),
            description: String(item.description),
            estimatedComplexity: this.clamp(Number(item.estimatedComplexity) || 5, 1, 10),
            dependencies: Array.isArray(item.dependencies)
                ? item.dependencies.map(String)
                : [],
            isolatedFiles: Array.isArray(item.isolatedFiles)
                ? item.isolatedFiles.map(String)
                : [],
            sharedFiles: Array.isArray(item.sharedFiles)
                ? item.sharedFiles.map(String)
                : [],
            expectedOutput: String(item.expectedOutput || ''),
        };
    }
    /**
     * LLM 自检
     */
    async selfCheck(subtasks) {
        const prompt = buildSelfCheckPrompt(subtasks);
        const response = await this.llm.callLLM(prompt, {
            temperature: 0.1,
            maxTokens: 2000,
        });
        const jsonMatch = response.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
        const jsonStr = (jsonMatch?.[1] ?? response).trim();
        try {
            return JSON.parse(jsonStr);
        }
        catch {
            return {
                missingDependencies: [],
                fileConflicts: [],
                overlyCoarse: [],
                overlyFine: [],
                warnings: [],
            };
        }
    }
    /**
     * 应用自检结果，修复 Subtask 列表
     */
    applySelfCheck(subtasks, result) {
        const taskMap = new Map(subtasks.map((t) => [t.id, { ...t }]));
        // 添加缺失依赖
        for (const { from, to } of result.missingDependencies) {
            const task = taskMap.get(from);
            if (task && !task.dependencies.includes(to)) {
                task.dependencies = [...task.dependencies, to];
            }
        }
        // 修复文件冲突：将 conflict 文件分配给 complexity 更高的 Agent
        for (const { file, taskA, taskB } of result.fileConflicts) {
            const a = taskMap.get(taskA);
            const b = taskMap.get(taskB);
            if (a && b) {
                const winner = (a.estimatedComplexity >= b.estimatedComplexity) ? a : b;
                const loser = (a.estimatedComplexity >= b.estimatedComplexity) ? b : a;
                // 失败者从 isolatedFiles 中移除该文件
                loser.isolatedFiles = loser.isolatedFiles.filter((f) => f !== file);
                // 添加到 sharedFiles（只读）
                if (!loser.sharedFiles.includes(file)) {
                    loser.sharedFiles = [...loser.sharedFiles, file];
                }
            }
        }
        return Array.from(taskMap.values());
    }
    /**
     * 构建依赖图邻接表
     */
    buildDependencyGraph(subtasks) {
        const graph = new Map();
        for (const t of subtasks) {
            graph.set(t.id, t.dependencies);
        }
        return graph;
    }
    /**
     * 拓扑排序，按层级分组
     * 第 0 层 = 无依赖，第 1 层 = 只依赖第 0 层，以此类推
     */
    topoSortBatches(subtasks, graph) {
        const taskMap = new Map(subtasks.map((t) => [t.id, t]));
        const inDegree = new Map();
        const dependents = new Map(); // taskId → 依赖它的 taskIds
        for (const t of subtasks) {
            inDegree.set(t.id, t.dependencies.length);
            for (const dep of t.dependencies) {
                const list = dependents.get(dep) || [];
                list.push(t.id);
                dependents.set(dep, list);
            }
        }
        const batches = [];
        let queue = Array.from(inDegree.entries())
            .filter(([, deg]) => deg === 0)
            .map(([id]) => id);
        while (queue.length > 0) {
            const batch = queue
                .map((id) => taskMap.get(id))
                .filter(Boolean);
            batches.push(batch);
            const nextQueue = [];
            for (const taskId of queue) {
                const deps = dependents.get(taskId) || [];
                for (const depId of deps) {
                    const newDeg = (inDegree.get(depId) || 0) - 1;
                    inDegree.set(depId, newDeg);
                    if (newDeg === 0) {
                        nextQueue.push(depId);
                    }
                }
            }
            queue = nextQueue;
        }
        return batches;
    }
    /**
     * 检测 DAG 是否有环（基于 DFS 的三色标记法）
     */
    isAcyclic(subtasks, graph) {
        const WHITE = 0, GRAY = 1, BLACK = 2;
        const color = new Map();
        for (const t of subtasks)
            color.set(t.id, WHITE);
        const dfs = (node) => {
            color.set(node, GRAY);
            for (const dep of graph.get(node) || []) {
                if (color.get(dep) === GRAY)
                    return false; // 环检测
                if (color.get(dep) === WHITE && !dfs(dep))
                    return false;
            }
            color.set(node, BLACK);
            return true;
        };
        for (const t of subtasks) {
            if (color.get(t.id) === WHITE && !dfs(t.id)) {
                return false;
            }
        }
        return true;
    }
    createFallbackTasks(userInput) {
        return [
            {
                id: 'fallback-analyze-1',
                description: `Analyze the user request: ${userInput}`,
                estimatedComplexity: 3,
                dependencies: [],
                isolatedFiles: [],
                sharedFiles: [],
                expectedOutput: 'An analysis report outlining the specific code changes needed.',
            },
            {
                id: 'fallback-execute-2',
                description: `Execute the changes based on the analysis for: ${userInput}`,
                estimatedComplexity: 7,
                dependencies: ['fallback-analyze-1'],
                isolatedFiles: [],
                sharedFiles: [],
                expectedOutput: 'The final code changes implemented and verified.',
            }
        ];
    }
    clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }
}
//# sourceMappingURL=decomposer.js.map