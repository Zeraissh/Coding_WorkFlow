/**
 * Orchestrator 拆解模板 — 通用领域的 few-shot 示例库
 *
 * 每种任务类型提供 3 个示例，供 LLM 参考拆解粒度、依赖声明和文件分配方式。
 */

import type { Subtask, DecomposerConfig } from './types';

// ============================================================================
// Template Types
// ============================================================================

export interface FewShotExample {
  input: string;
  context?: string; // 项目上下文（可选）
  subtasks: Subtask[];
}

export interface TaskTemplate {
  category: DecomposerConfig['fewShotCategory'];
  systemPrompt: string;
  examples: FewShotExample[];
}

// ============================================================================
// Templates
// ============================================================================

const BUGFIX_TEMPLATE: TaskTemplate = {
  category: 'bugfix',
  systemPrompt: `你是一个 Bug 修复任务拆解器。将用户的 Bug 描述拆解为可独立执行的子任务。

规则：
1. 先搜索后修复：搜索代码的子任务必须排在修复子任务之前
2. 每个子任务必须声明 isolatedFiles（独占写入的文件）
3. 只读搜索的文件放在 sharedFiles 中
4. estimatedComplexity 取 1-10，搜索类任务 1-3，修复类任务 4-7，验证据类任务 3-5
5. 子任务不超过 5 个
6. 输出为 JSON 数组`,

  examples: [
    {
      input: '串口通信偶尔断开，需要定位并修复',
      context: 'TypeScript 项目，串口代码在 src/serial/ 目录下',
      subtasks: [
        {
          id: 'ser-1',
          description: '搜索项目中所有串口打开/关闭/读写的代码位置，列出异常处理逻辑',
          estimatedComplexity: 2,
          dependencies: [],
          isolatedFiles: [],
          sharedFiles: ['src/serial/'],
          expectedOutput: '串口代码位置清单 + 异常处理现状报告',
        },
        {
          id: 'ser-2',
          description: '分析串口断开的根因：检查错误处理、超时机制、重连逻辑',
          estimatedComplexity: 6,
          dependencies: ['ser-1'],
          isolatedFiles: ['src/serial/reconnect.ts'],
          sharedFiles: ['src/serial/serialPort.ts'],
          expectedOutput: '根因分析报告 + 含有重连逻辑的 reconnect.ts',
        },
        {
          id: 'ser-3',
          description: '编写串口重连的单元测试，覆盖断开/超时/重连场景',
          estimatedComplexity: 4,
          dependencies: ['ser-2'],
          isolatedFiles: ['src/serial/reconnect.test.ts'],
          sharedFiles: ['src/serial/reconnect.ts'],
          expectedOutput: 'reconnect.test.ts 测试文件',
        },
      ],
    },
    {
      input: '用户登录后偶尔闪退到登录页',
      context: 'React SPA，auth 在 src/auth/',
      subtasks: [
        {
          id: 'auth-1',
          description: '搜索所有与 token 刷新和 session 管理相关的代码',
          estimatedComplexity: 2,
          dependencies: [],
          isolatedFiles: [],
          sharedFiles: ['src/auth/', 'src/api/'],
          expectedOutput: 'token/session 代码清单',
        },
        {
          id: 'auth-2',
          description: '修复 token 过期导致的闪退问题，添加 token 刷新拦截器',
          estimatedComplexity: 5,
          dependencies: ['auth-1'],
          isolatedFiles: ['src/auth/tokenInterceptor.ts'],
          sharedFiles: ['src/auth/authContext.tsx'],
          expectedOutput: 'tokenInterceptor.ts 含自动刷新逻辑',
        },
        {
          id: 'auth-3',
          description: '验证修复：确保 token 过期场景下不会跳转登录页',
          estimatedComplexity: 3,
          dependencies: ['auth-2'],
          isolatedFiles: ['src/auth/tokenInterceptor.test.ts'],
          sharedFiles: ['src/auth/tokenInterceptor.ts'],
          expectedOutput: '测试文件 + 验证报告',
        },
      ],
    },
    {
      input: '数据库查询在数据量大时返回超时',
      context: 'Node.js + PostgreSQL, ORM 在 src/db/',
      subtasks: [
        {
          id: 'db-1',
          description: '搜索所有慢查询代码和现有索引配置',
          estimatedComplexity: 3,
          dependencies: [],
          isolatedFiles: [],
          sharedFiles: ['src/db/', 'src/models/'],
          expectedOutput: '慢查询清单 + 现有索引列表',
        },
        {
          id: 'db-2',
          description: '优化查询：添加数据库索引 + 重构 N+1 查询为批量查询',
          estimatedComplexity: 6,
          dependencies: ['db-1'],
          isolatedFiles: ['src/db/migrations/add_indexes.sql', 'src/db/queryOptimizer.ts'],
          sharedFiles: ['src/models/'],
          expectedOutput: '索引 SQL + 优化后的查询代码',
        },
        {
          id: 'db-3',
          description: '添加查询超时保护和性能基准测试',
          estimatedComplexity: 4,
          dependencies: ['db-2'],
          isolatedFiles: ['src/db/queryTimeout.ts', 'src/db/benchmark.test.ts'],
          sharedFiles: [],
          expectedOutput: '超时保护 + 基准测试',
        },
      ],
    },
  ],
};

const CODE_TEMPLATE: TaskTemplate = {
  category: 'code',
  systemPrompt: `你是一个代码生成任务拆解器。将用户的开发需求拆解为可独立并行执行的子任务。

规则：
1. 核心代码先写，测试后写
2. 无依赖的子任务可以并行（dependencies 留空）
3. 每个子任务声明 isolatedFiles，防止并发写冲突
4. 类型/接口定义如果是共享的，放在 sharedFiles
5. estimatedComplexity: 简单文件 1-3, 复杂逻辑 4-7, 完整系统模块 7-10
6. 子任务不超过 8 个
7. 输出为 JSON 数组`,

  examples: [
    {
      input: '用 Python 写一个带计分板的贪吃蛇游戏，并提供单元测试',
      subtasks: [
        {
          id: 'snake-1',
          description: '编写贪吃蛇核心逻辑：蛇的移动、食物生成、碰撞检测',
          estimatedComplexity: 5,
          dependencies: [],
          isolatedFiles: ['snake_game/core.py'],
          sharedFiles: [],
          expectedOutput: 'core.py — 蛇移动/食物/碰撞逻辑',
        },
        {
          id: 'snake-2',
          description: '编写计分板逻辑：分数记录、排行榜管理、持久化',
          estimatedComplexity: 4,
          dependencies: [],
          isolatedFiles: ['snake_game/scoreboard.py'],
          sharedFiles: [],
          expectedOutput: 'scoreboard.py — 计分/排行/存储',
        },
        {
          id: 'snake-3',
          description: '编写 GUI 渲染层：使用 pygame 渲染蛇、食物、计分板',
          estimatedComplexity: 5,
          dependencies: ['snake-1', 'snake-2'],
          isolatedFiles: ['snake_game/renderer.py', 'snake_game/main.py'],
          sharedFiles: ['snake_game/core.py', 'snake_game/scoreboard.py'],
          expectedOutput: 'renderer.py + main.py 入口',
        },
        {
          id: 'snake-4',
          description: '编写单元测试：覆盖核心逻辑和计分板逻辑',
          estimatedComplexity: 4,
          dependencies: ['snake-1', 'snake-2'],
          isolatedFiles: ['tests/test_core.py', 'tests/test_scoreboard.py'],
          sharedFiles: ['snake_game/core.py', 'snake_game/scoreboard.py'],
          expectedOutput: 'test_core.py + test_scoreboard.py',
        },
      ],
    },
    {
      input: '用 TypeScript 写一个 Express REST API，支持用户 CRUD',
      subtasks: [
        {
          id: 'api-1',
          description: '定义数据模型和 TypeScript 类型',
          estimatedComplexity: 2,
          dependencies: [],
          isolatedFiles: ['src/types.ts', 'src/models/user.ts'],
          sharedFiles: [],
          expectedOutput: 'types.ts + user model',
        },
        {
          id: 'api-2',
          description: '编写用户 CRUD 路由和控制器',
          estimatedComplexity: 5,
          dependencies: ['api-1'],
          isolatedFiles: ['src/routes/users.ts', 'src/controllers/userController.ts'],
          sharedFiles: ['src/types.ts', 'src/models/user.ts'],
          expectedOutput: 'REST API 路由 + 控制器',
        },
        {
          id: 'api-3',
          description: '编写中间件：错误处理、输入校验、认证',
          estimatedComplexity: 4,
          dependencies: [],
          isolatedFiles: ['src/middleware/errorHandler.ts', 'src/middleware/validator.ts'],
          sharedFiles: ['src/types.ts'],
          expectedOutput: '中间件文件',
        },
        {
          id: 'api-4',
          description: '编写 Express 应用入口和配置',
          estimatedComplexity: 2,
          dependencies: ['api-2', 'api-3'],
          isolatedFiles: ['src/app.ts', 'src/config.ts'],
          sharedFiles: ['src/routes/', 'src/middleware/'],
          expectedOutput: 'app.ts 入口 + 配置',
        },
        {
          id: 'api-5',
          description: '编写集成测试和 API 文档',
          estimatedComplexity: 4,
          dependencies: ['api-2', 'api-3'],
          isolatedFiles: ['tests/users.test.ts'],
          sharedFiles: ['src/app.ts'],
          expectedOutput: '集成测试 + API 文档',
        },
      ],
    },
    {
      input: '创建一个 React 组件库，包含 Button、Input、Modal 三个基础组件',
      subtasks: [
        {
          id: 'ui-1',
          description: '搭建项目结构和配置：Vite + TypeScript + Storybook',
          estimatedComplexity: 3,
          dependencies: [],
          isolatedFiles: ['package.json', 'vite.config.ts', 'tsconfig.json', '.storybook/'],
          sharedFiles: [],
          expectedOutput: '项目脚手架',
        },
        {
          id: 'ui-2',
          description: '实现 Button 组件及其样式变体',
          estimatedComplexity: 3,
          dependencies: ['ui-1'],
          isolatedFiles: ['src/components/Button/', 'src/components/Button/Button.stories.tsx'],
          sharedFiles: ['src/styles/'],
          expectedOutput: 'Button 组件 + Story',
        },
        {
          id: 'ui-3',
          description: '实现 Input 组件及其样式变体',
          estimatedComplexity: 4,
          dependencies: ['ui-1'],
          isolatedFiles: ['src/components/Input/', 'src/components/Input/Input.stories.tsx'],
          sharedFiles: ['src/styles/'],
          expectedOutput: 'Input 组件 + Story',
        },
        {
          id: 'ui-4',
          description: '实现 Modal 组件及其动画效果',
          estimatedComplexity: 6,
          dependencies: ['ui-1'],
          isolatedFiles: ['src/components/Modal/', 'src/components/Modal/Modal.stories.tsx'],
          sharedFiles: ['src/styles/', 'src/hooks/'],
          expectedOutput: 'Modal 组件 + Story',
        },
        {
          id: 'ui-5',
          description: '编写组件单元测试',
          estimatedComplexity: 4,
          dependencies: ['ui-2', 'ui-3', 'ui-4'],
          isolatedFiles: ['src/components/Button/Button.test.tsx', 'src/components/Input/Input.test.tsx', 'src/components/Modal/Modal.test.tsx'],
          sharedFiles: ['src/components/'],
          expectedOutput: '三个组件的测试文件',
        },
      ],
    },
  ],
};

const GENERAL_TEMPLATE: TaskTemplate = {
  category: 'general',
  systemPrompt: `你是一个通用任务拆解器。将用户的复杂任务拆解为可独立执行的子任务。

规则：
1. 按逻辑阶段拆解：信息收集 → 分析/设计 → 执行 → 验证
2. 无依赖的阶段可并行
3. estimatedComplexity: 信息收集 1-3, 分析 3-6, 执行 4-8, 验证 2-5
4. 子任务不超过 8 个
5. 输出为 JSON 数组`,

  examples: [
    {
      input: '分析这个项目的代码质量并给出改进建议',
      subtasks: [
        {
          id: 'quality-1',
          description: '统计代码量、文件分布、依赖关系',
          estimatedComplexity: 2,
          dependencies: [],
          isolatedFiles: [],
          sharedFiles: ['src/'],
          expectedOutput: '代码统计报告',
        },
        {
          id: 'quality-2',
          description: '运行 lint 和类型检查，收集问题列表',
          estimatedComplexity: 2,
          dependencies: [],
          isolatedFiles: [],
          sharedFiles: [],
          expectedOutput: 'lint/type 错误清单',
        },
        {
          id: 'quality-3',
          description: '分析代码架构、模块耦合度和设计模式使用',
          estimatedComplexity: 5,
          dependencies: ['quality-1'],
          isolatedFiles: [],
          sharedFiles: ['src/'],
          expectedOutput: '架构分析报告',
        },
        {
          id: 'quality-4',
          description: '综合代码统计、lint 结果和架构分析，生成最终改进建议',
          estimatedComplexity: 4,
          dependencies: ['quality-1', 'quality-2', 'quality-3'],
          isolatedFiles: ['IMPROVEMENT_REPORT.md'],
          sharedFiles: [],
          expectedOutput: 'IMPROVEMENT_REPORT.md 最终报告',
        },
      ],
    },
    {
      input: '搭建一个 GitHub Actions CI/CD 流水线',
      subtasks: [
        {
          id: 'ci-1',
          description: '编写 build 工作流：安装依赖 → 编译 → 打包',
          estimatedComplexity: 3,
          dependencies: [],
          isolatedFiles: ['.github/workflows/build.yml'],
          sharedFiles: [],
          expectedOutput: 'build.yml',
        },
        {
          id: 'ci-2',
          description: '编写 test 工作流：lint → 类型检查 → 单元测试',
          estimatedComplexity: 3,
          dependencies: [],
          isolatedFiles: ['.github/workflows/test.yml'],
          sharedFiles: [],
          expectedOutput: 'test.yml',
        },
        {
          id: 'ci-3',
          description: '编写 deploy 工作流：构建 Docker 镜像 → 推送到 registry → 部署',
          estimatedComplexity: 5,
          dependencies: ['ci-1', 'ci-2'],
          isolatedFiles: ['.github/workflows/deploy.yml', 'Dockerfile'],
          sharedFiles: [],
          expectedOutput: 'deploy.yml + Dockerfile',
        },
      ],
    },
    {
      input: '用中文写一份 2000 字的技术方案文档',
      subtasks: [
        {
          id: 'doc-1',
          description: '调查现有方案和技术选型，收集参考资料',
          estimatedComplexity: 3,
          dependencies: [],
          isolatedFiles: [],
          sharedFiles: [],
          expectedOutput: '技术调研笔记',
        },
        {
          id: 'doc-2',
          description: '编写方案主体：背景、目标、技术选型、架构设计',
          estimatedComplexity: 6,
          dependencies: ['doc-1'],
          isolatedFiles: ['docs/proposal.md'],
          sharedFiles: [],
          expectedOutput: 'proposal.md 主体',
        },
        {
          id: 'doc-3',
          description: '补充实施计划、风险评估、时间线',
          estimatedComplexity: 3,
          dependencies: ['doc-2'],
          isolatedFiles: ['docs/proposal.md'],
          sharedFiles: [],
          expectedOutput: 'proposal.md 补充内容（追加）',
        },
      ],
    },
  ],
};

// ============================================================================
// 模板注册表
// ============================================================================

const TEMPLATE_REGISTRY: Record<string, TaskTemplate> = {
  bugfix: BUGFIX_TEMPLATE,
  code: CODE_TEMPLATE,
  general: GENERAL_TEMPLATE,
};

/**
 * 获取指定类别的模板
 */
export function getTemplate(category: DecomposerConfig['fewShotCategory']): TaskTemplate {
  if (category === 'auto') {
    // 'auto' 返回通用模板，实际分类由上层判断
    return GENERAL_TEMPLATE;
  }
  return TEMPLATE_REGISTRY[category] || GENERAL_TEMPLATE;
}

/**
 * 自动检测任务类别
 */
export function detectCategory(userInput: string): DecomposerConfig['fewShotCategory'] {
  const lower = userInput.toLowerCase();

  const bugKeywords = ['bug', '修复', '错误', '崩溃', '断开', '闪退', '异常', 'fix', 'error', 'crash', 'broken'];
  const codeKeywords = ['写', '创建', '实现', '开发', '生成', '搭建', 'write', 'create', 'build', 'generate', 'implement'];

  const bugScore = bugKeywords.filter((k) => lower.includes(k)).length;
  const codeScore = codeKeywords.filter((k) => lower.includes(k)).length;

  if (bugScore > codeScore) return 'bugfix';
  if (codeScore > 0) return 'code';
  return 'general';
}

/**
 * 构建拆解 prompt（JSON 输出格式）
 */
export function buildDecompositionPrompt(
  userInput: string,
  category: DecomposerConfig['fewShotCategory'],
  config: DecomposerConfig
): string {
  const template = getTemplate(category);

  const examplesText = template.examples
    .map(
      (ex, i) => `
### 示例 ${i + 1}
输入: "${ex.input}"
${ex.context ? `项目上下文: ${ex.context}` : ''}
输出:
\`\`\`json
${JSON.stringify(ex.subtasks, null, 2)}
\`\`\``
    )
    .join('\n');

  return `${template.systemPrompt}

## 约束
- 最多拆解为 ${config.maxSubtasks} 个子任务
- 复杂度低于 ${config.minComplexityForSplit} 的任务不需要拆解
- 每个子任务必须声明 isolatedFiles（独占写入文件）和 expectedOutput（期望产出）

${examplesText}

## 当前任务
用户输入: "${userInput}"

请以 JSON 数组格式输出 SubTask 列表。每个元素包含: id, description, estimatedComplexity (1-10), dependencies (string[]), isolatedFiles (string[]), sharedFiles (string[]), expectedOutput (string)。

只输出 JSON，不要其他解释。`;
}

/**
 * 构建自检 prompt
 */
export function buildSelfCheckPrompt(subtasks: Subtask[]): string {
  const tasksSummary = subtasks
    .map((t) => `- [${t.id}] ${t.description} (独占文件: ${t.isolatedFiles.join(', ') || '无'}, 依赖: ${t.dependencies.join(', ') || '无'})`)
    .join('\n');

  return `检查以下任务拆解是否存在问题。回答三个问题：

## 当前拆解
${tasksSummary}

## 检查清单
1. 子任务 A 和 B 之间是否存在隐式依赖（逻辑上必须先完成A才能做B，但dependencies中没有声明）？
2. 是否存在两个子任务争抢同一文件（isolatedFiles 有重叠，或 sharedFiles 被两个子任务同时声明为 isolatedFiles）？
3. 有没有子任务粒度太粗需要再拆（estimatedComplexity >= 8），或太细应该合并？

以 JSON 格式输出：
{
  "missingDependencies": [{ "from": "task-id", "to": "task-id", "reason": "..." }],
  "fileConflicts": [{ "file": "...", "taskA": "task-id", "taskB": "task-id" }],
  "overlyCoarse": ["task-id"],
  "overlyFine": ["task-id"],
  "warnings": ["任何其他问题"]
}`;
}
