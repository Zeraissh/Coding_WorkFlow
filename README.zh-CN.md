# Coding Workflow（`autocode`）

[![CI](https://github.com/Zeraissh/Coding_WorkFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/Zeraissh/Coding_WorkFlow/actions/workflows/ci.yml)

**[English README](README.md)**

一个**带资源治理与自我进化闭环的并行多 Agent 编码引擎**。给它一个目标：自动分解为任务 DAG、子 Agent 在文件锁与 Token 预算约束下并发执行、两阶段验证合成交付物，并从每次运行中学习。

主流编码 Agent（Aider、Cline）是串行的。本引擎押注的是另一条路线：**分解 → 并行 → 治理 → 验证 → 进化**。

## 核心能力

| 能力 | 说明 |
|---|---|
| 🔀 **并行子 Agent** | 目标分解为依赖 DAG，拓扑排序成批次并发执行（有界池）；`FSLock` 写互斥杜绝并行写坏同一文件 |
| 💰 **Token 预算治理** | 按复杂度权重分配预算，70/85/95% 三级水位；Agent 提前完工时盈余动态重分配给存活 Agent，告别账单暴雷 |
| 🔍 **需求澄清阶段** | "开发一款扫地机器人"一句话背后是固件+上位机+协议选型。复杂模糊目标触发调研增强的选择题（选项引用真实产品与 GitHub 项目），产出需求规格作为分解契约；简单任务完全不打扰 |
| 🎯 **专注度监控** | 逐 Agent 检测越界写入、同参循环、空转烧 token：轻度漂移注入 refocus 警告，崩溃则挂起工具执行强制收束；专注度分数实时推 Dashboard |
| 📊 **可归因评测** | 每次运行记录 per-task 成败、验证结果（lint/type/冲突/语义计数）、生效规则 hash、提示词版本、命中 skill——"哪次改动伤了质量"是一句查询而不是猜测 |
| 📚 **会进化的规则与 Skill** | 教训去重为带域标签的规则（长期未验证自动待退役）；相似成功自动起草可复用 skill（LLM 起草、**人工激活**，绝不静默自改）；低胜率 skill 自动退役 |
| 🛡 **两阶段验证** | 规则式 `AutoChecker`（lint/类型/测试/文件冲突）+ LLM `SemanticReviewer`，最后合成一份连贯交付物 |
| 🧰 **生产级卫生** | diff 式 `edit_file` 工具、流式输出、可恢复的 E-Stop、SSE 心跳重连、路径越界防护+危险命令黑名单、原子状态写入、长任务上下文压缩 |

## 快速上手

```bash
git clone https://github.com/Zeraissh/Coding_WorkFlow.git
cd Coding_WorkFlow
npm install
npm link            # 注册全局 autocode 命令

autocode config     # 选择服务商（Anthropic / OpenAI / DeepSeek）、模型、API 密钥
cd 你的项目
autocode chat       # 交互式会话 + Dashboard（http://localhost:3000）
```

一次性模式：

```bash
autocode run "找出并修复导致串口断开的 Bug"
autocode run "..." --resume    # 恢复被中断的工作流
```

## Dashboard

`autocode chat`/`run` 会在 `http://localhost:3000` 提供实时面板：

- 任务看板：逐任务日志、流式模型输出、token 消耗、专注度分数
- HITL 审批弹窗：终端命令与最终 diff
- 澄清阶段问卷（选项附调研依据）
- 紧急 **Stop**（状态已存可恢复）、连接健康指示

## 自我进化闭环

```
澄清（需求规格）→ 专注执行（作用域规则 + skill）
      ↑                          ↓
回归门禁（autocode eval）← 规则去重/退役 + skill 胜率 ← 归因评测
```

- `autocode eval --label baseline`：跑回归用例集（`.workflow/eval_suite/cases.json`）并与上次对比，出现回归时退出码 1，可直接进 CI。任何提示词/规则/skill 改动前后各跑一次。
- Skill 存放在 `.workflow/skills/*.md`（frontmatter + 提示词正文），可手工编辑、关键词匹配、胜率追踪。
- 知识库（`.workflow/knowledge/`）沉淀需求与决策，Agent 通过 `query_knowledge` 工具先查再行动。

## 在 Claude Code / Cursor 中调用（MCP）

把引擎暴露为 MCP server：

```bash
autocode mcp-serve
```

暴露的工具：`run_workflow`、`query_knowledge`、`list_skills`、`get_eval_summary`。Claude Code 配置示例：

```json
{
  "mcpServers": {
    "coding-workflow": { "command": "autocode", "args": ["mcp-serve"] }
  }
}
```

## 编程式调用

```ts
import { Orchestrator } from 'coding_workflow';

const orchestrator = new Orchestrator();
const result = await orchestrator.executeWorkflow('创建一个带测试的 CLI 待办应用');
```

参见 `examples/basic-workflow.ts` 与 `examples/custom-tool.ts`。

## 配置

`autocode config` 写入 `~/.workflow_config.json`。可选配置段：`orchestratorConfig`、`agentConfig`（工具调用上限、并行池）、`clarifyConfig`（auto 模式、复杂度阈值）、`focusConfig`（阈值）、`budgetConfig`、`fslockConfig`、`verifierConfig`。

API 密钥也可用环境变量：`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY`（见 `.env.example`）。

## 开发

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest（171 个测试）
npm run build       # 输出到 dist/
```

CI 在每个 PR 上跑全矩阵（Windows + Linux × Node 20/22）。版本历史见 [CHANGELOG.md](CHANGELOG.md)。

## License

ISC
