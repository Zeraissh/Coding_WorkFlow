# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
