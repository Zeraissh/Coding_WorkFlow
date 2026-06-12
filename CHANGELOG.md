# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased] — P2 核心竞争力

### Added
- **`edit_file` 工具**：精确 search/replace 块编辑（唯一匹配校验 + `replace_all`），失败时返回可操作的纠错指引；`write_file` 定位收窄为新建/全量覆写
- **流式输出**：`askLLM` 全面 streaming（Anthropic stream helper / OpenAI chunk 累积），新增 `assistantDelta` 事件实时推送到 Dashboard 任务卡
- **E-Stop**：`src/core/abort.ts` 工作流级 AbortController 贯穿 orchestrator→agent→LLM；`POST /api/stop`；批次边界安全停止且状态可 resume；Dashboard 红色 Stop 按钮
- **SSE 可靠性**：服务端 15s 心跳；前端断线指数退避重连（1s→30s 封顶）+ 连接状态指示器，重连后由事件历史重放重建状态
- **zod schema 校验**：decomposer 子任务与自检 JSON 输出经 `orchestrator/schemas.ts` 校验，非法条目丢弃并走既有重试/兜底链路
- **配置化参数**：`agentConfig.maxToolCalls`（默认 25）、`agentConfig.parallelPoolSize`（默认 5）收编进 `~/.workflow_config.json`

### Changed
- 默认模型更新为 `claude-sonnet-4-6`；CLI 配置向导模型列表更新到当前模型族（claude-fable-5 / opus-4-8 / haiku-4.5）

## [Unreleased] — P0/P1 加固

### Security
- 内置工具新增路径越界防护：`read_file`/`write_file`/`list_dir`/`grep_search` 强制限制在项目根目录内（`src/core/security.ts`）
- `run_terminal_command` 新增危险命令黑名单（递归删根、format、管道执行远程脚本、force push 等），独立于 HITL 审批生效
- 新增 `.env.example` 模板；`.gitignore` 覆盖 `.env*`、`.workflow/`、`__pycache__/` 等运行产物

### Fixed
- `TokenBudgetManager.rebalance` 幂等化：同一完成任务的剩余额度不会再被重复派发；Orchestrator 改为调用 `markCompleted`（此前从不标记完成，导致已完成任务仍被视为活跃）
- `state.json` 改为临时文件 + rename 的原子写入，并在 resume 前校验结构，进程中断不再损坏状态
- 修复 `tsconfig.json`：编译产物输出到 `dist/`，不再污染 `src/`

### Changed
- 仓库清理：移除约 30 个 demo 运行残留文件；Python 串口示例迁移至 `examples/serial-demo/`；分析报告迁移至 `docs/reports/`
- 静默吞错改为带上下文的 warn 日志（indexer/orchestrator/agent/server）
- `package.json` 新增 `files`/`engines`/`prepublishOnly`；新增 `npm run typecheck`

### Added
- GitHub Actions CI（Windows + Linux × Node 20/22：typecheck、vitest、build）
- 核心逻辑测试套件：Decomposer DAG 拓扑/自检/兜底、FSLock 互斥/重入/冲突日志、TokenBudget 分配/水位/再平衡、StateManager 原子性（76 tests）

## [1.0.1] - 2026-06 之前

- 初始版本：多 Agent 并行编排引擎（Orchestrator/SubAgent/Verifier）、Token 预算、FSLock、本地 RAG、MCP 集成、HITL Dashboard
