# Changelog

本项目遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased] — 架构：共享嵌入模型（消除双份加载）

### Changed
- **ProjectIndexer 复用共享 embedder**：此前代码 RAG（indexer.ts）和知识库（embedder.ts）各自 `pipeline('feature-extraction', MiniLM)` 加载一份 ~90MB 模型——同一进程内**两次模型加载**。现在 indexer 也走 `embedText`，全进程只加载一份，并自动继承共享 embedder 的离线降级（不可用时 RAG 无声降级，不再各自处理）
- 移除 indexer 内重复的 transformers/pipeline 加载与降级逻辑
- 测试基线 → 250（indexer 在嵌入不可用时优雅降级、不加载原生模型、search 返回 []）
- 注：散落的 `new RuleStore()`/`new SkillRegistry()` 等是廉价小文件读，其并发写问题归到下一项（D 单例并发）一起处理

## [Unreleased] — 修复：DAG 失败传播

### Fixed
- **前置任务失败时后继照常硬跑**（correctness bug）：批次按拓扑顺序执行，但此前不检查某任务的依赖是否成功——前置失败了，依赖它的后继任务仍会拿着缺失的前提执行，产出错误结果。现在调度前按 taskId 查依赖成败，任一依赖未成功（失败或被跳过）则**跳过该任务并标记 skipped（带原因）**，失败沿 DAG 传递（被跳过任务记为 success=false，其后继也连带跳过）
- 抽出纯函数 `failedDependencyOf(task, successByTask)` 便于单测（安全默认：依赖未知不跳过，只在确认失败时跳）
- 测试基线 → 248（6 个传播逻辑测试）

## [Unreleased] — 修复：观测/归因下沉到引擎（之前主路径不采集）

### Fixed
- **进化闭环归因数据在主执行路径根本不采集**（潜在 bug）：Tracer/Evaluator 此前只在死代码 `dashboard/server.ts` 里实例化，而 CLI 用的 `server/index.ts` 零实例化——导致 `autocode run`/`chat`、编程式 SDK 调用、MCP 三条路径都不写 `eval_logs.json`，自我进化的输入数据缺失。现由 `executeWorkflow` 在其生命周期内统一启停观测器（`src/core/observers.ts`，begin/end 仿 abort/sandbox scope），三路径一致采集 trace + eval 归因

### Changed
- 观测属于引擎职责，从传输层（server）下沉到引擎：server 只保留 SSE 转发
- **删死代码**：`dashboard/server.ts`（无人 import 的重复 server 实现）；`start_dashboard.ts` 改用统一的 `startServer`，消除两套 server 并存
- 测试基线 → 242（observers 落盘 eval+trace、dispose 解绑）

## [Unreleased] — 沙箱 v2：持久容器（保留跨命令状态）

### Added
- **持久沙箱容器**（`SandboxSession` in `src/core/sandbox.ts`）：沙箱开启时，整个工作流共用**一个**常驻容器（`docker run -d … sleep infinity`），命令经 `docker exec` 跑进去，结束销毁——`cd`/环境变量/已装依赖在命令间保留，贴近真实 shell。会话生命周期绑定 `executeWorkflow`（仿 abort scope），失败安全失败（Docker 不可用即报错，不回退宿主）
- v1 单命令容器退为兜底：工作流之外执行命令时仍走每命令一个 `--rm` 容器
- 纯参数构建 `buildRunDaemonArgs`/`buildExecArgs`（可测）；命令仍作为单 arg 传 `sh -c`，杜绝注入；docs/sandbox.md 更新执行模式说明
- 测试基线 → 240（守护容器/exec 参数、会话 scope、未起容器即 exec 报错）

## [Unreleased] — 知识库语义检索（词法兜底）

### Added
- **嵌入式语义检索**：`query_knowledge` 从纯词法升级为基于嵌入的语义检索。新增 `src/core/embedder.ts`——共享、惰性加载、**失败即降级**的文本嵌入（模型不可用时 `embedText` 返回 null，与全局离线韧性一致）+ `cosineSimilarity`，支持 `HF_ENDPOINT` 镜像
- `knowledge.ts` 新增 `semanticSearch`：嵌入查询并按余弦相似度排序分块；分块嵌入缓存在 `.workflow/knowledge/.embeddings.json`（跨检索不重复计算，重复检索只嵌入查询本身）；嵌入不可用时回退既有词法检索。词法检索保留并重构为共享分块逻辑
- `query_knowledge` 工具与 MCP server 改用 semanticSearch
- 测试基线 → 234（cosine 纯函数 + 注入式语义排序 + 词法兜底 + 嵌入缓存）

## [Unreleased] — 测试深度：AutoChecker + SnapshotManager

### Added
- **AutoChecker 测试**（`tests/autoChecker.test.ts`，6）：790 行的规则式验证引擎此前零覆盖。借其可注入的 runShell/readFile/fileExists 依赖，用真实格式测了文件冲突检测、无工具链时干净通过、eslint JSON 解析、tsc 两种错误格式解析
- **SnapshotManager 测试**（`tests/snapshotManager.test.ts`，4）：快照创建、回滚（恢复改动/删除/移除新增文件）、prune、空快照 no-op
- 继续把"核心引擎测试 4/10"往上推

## [Unreleased] — 效率：省去无谓的规划 LLM 调用

### Changed
- **跳过单任务自检**：decomposer 的自检阶段分析子任务间的依赖/文件冲突，≤1 个子任务时无可检之处——此时跳过这次 LLM 调用（简单/兜底任务每次省一次往返）
- **澄清禁用即短路**：`clarifyConfig.enabled=false` 时直接返回，不再先调一次缺口评估再丢弃
- 这两处都是确定性正确的优化（不改变任何多任务工作流的行为），直接降低简单任务的 token 成本与延迟；省下的成本现在能在运行 trace（见上一节）里看到

## [Unreleased] — 观测性：运行 trace + 成本估算

### Added
- **结构化运行 trace**（`src/core/tracer.ts`）：订阅事件总线把每次工作流装配成可查询 JSON（workflow → 各 task 的状态/token/LLM 调用/改动文件/专注度 → 总 token/成本/耗时），原子写入 `.workflow/traces/<id>.json`。把黑盒变成可调试的记录
- **成本估算**：`estimateCostUsd` 按模型单价（input/cached/output 分别计价）估算每次运行的美元成本；`llmUsageReport` 事件增补 `inputTokens`/`outputTokens`/`model` 字段（向后兼容）；新增 `costReport` 事件，Dashboard 最终输出区内联显示 `~$x.xx`
- 测试基线 205 → 213（成本计价纯函数 + 事件驱动 trace 装配 8 个测试）

## [Unreleased] — 可选 Docker 沙箱（隔离 shell 执行）

### Added
- **Docker 沙箱**（`src/core/sandbox.ts`）：默认关闭，开启后 `run_terminal_command` 在一次性 Docker 容器内执行（`docker run --rm -v <项目>:/workspace`），命令无法访问宿主进程/项目外文件、资源受限（memory/cpus/pids）、用完即焚；项目目录经 bind mount 共享所以代码改动持久化。替代此前"命令黑名单+路径牢笼"这一尽力而为的防线，提供真正的进程/文件系统隔离
- **安全失败**：开启沙箱但 Docker 不可用时命令直接报错，绝不悄悄回退宿主执行
- 新配置 `sandboxConfig`（enabled/image/network/memory/cpus，见 [docs/sandbox.md](docs/sandbox.md)）；命令黑名单在沙箱模式下仍生效（纵深防御）
- 测试基线 200 → 205（buildDockerArgs 参数构建、配置解析、注入防护——确定性纯逻辑；容器执行属集成测试，在 WSL 手测）

## [Unreleased] — 治理界面（进化闭环人工环节 UI 化）

### Added
- **Dashboard skill/规则治理面板**：进化闭环此前自动起草 skill、提议退役规则，但激活草稿/退役 skill/归档规则只能手动改文件。新增 `src/core/governance.ts`（纯逻辑层，8 个单测）+ `/api/governance` 系列端点 + Dashboard 侧边栏 🧬 Governance 面板：列出 skill（状态/胜率 + activate/retire 按钮）与待退役规则（keep/archive 按钮）
- `SkillRegistry.retireSkill(id)`：HITL 手动退役 skill（保留历史胜负计数）
- SSE 实时转发 `skillDraftProposed`/`skillRetired`/`ruleRetirementProposed`，面板自动刷新——用户随时知道有东西待审批
- 测试基线 192 → 200

## [Unreleased] — 核心引擎测试覆盖

### Added
- **核心引擎 mock-LLM 测试**（此前 orchestrator/agent/verifier 仅靠 SWE-bench 间接验证，零直接单测）：
  - `tests/agent.test.ts`（7）：SubAgent.execute 全流程——工具组装、工具循环写文件落盘 + 执行日志记录、成功/失败结果映射、预算耗尽短路（不调 LLM）、文件锁释放、专注度越界写入触发干预
  - `tests/orchestratorPlan.test.ts`（5）：planWorkflow——依赖排序的并行批次、独立任务同批、简单目标跳过澄清阶段、解析失败回退双任务模板、Template: 短路不调 LLM
  - `tests/verifier.test.ts`（4）：verifyAndSynthesize 合成路径 + verificationReport 事件 + 部分失败仍合成
- 测试基线 176 → **192**。手法：`vi.mock` 替换唯一 LLM 入口 `askLLM`、stub 嵌入索引器、临时 cwd 隔离副作用

## [Unreleased] — P3 分发（MCP server、发布流水线、双语文档）

### Added
- **MCP server 模式**：`autocode mcp-serve`——引擎本身暴露为 MCP server（stdio），Claude Code/Cursor 可直接调用 `run_workflow`/`query_knowledge`/`list_skills`/`get_eval_summary` 四个工具；stdio 模式下 console.log 自动重定向 stderr 防止污染 JSON-RPC
- **npm 发布流水线**：`.github/workflows/release.yml`——推送 `v*` tag 自动 typecheck+test+build+`npm publish --provenance` 并创建 GitHub Release（需配置 `NPM_TOKEN` secret）
- **双语 README**：英文 `README.md`（主）重写，反映全部当前能力与差异化叙事；中文版迁移至 `README.zh-CN.md`（修复旧版重复段落与过时内容）
- package.json 补充 keywords 与 files（npm 检索与打包完整性）

## [Unreleased] — P2 收尾（repo map、上下文压缩、重度干预）

### Added
- **Repo Map**：`src/core/repomap.ts`——正则提取 6 类语言（TS/JS、Python、Go、Java/C#、C/C++、Rust）的顶层符号，渲染"文件 → 符号"紧凑地图注入规划上下文，替代纯目录树（空仓库自动回退）；零原生依赖
- **长任务上下文压缩**：`compactMessagesInPlace`（llm/client.ts）——会话超水位（默认 15 万字符）时把最近 6 条之外的旧 tool_result 折叠为 300 字符摘要，工具循环每轮自动执行，防止长任务上下文爆炸；assistant 的 tool_use 块保持原样维持协议配对
- **专注度重度干预（C.2）**：`FocusMonitor.shouldAbort()`——分数 ≤ 阈值（默认 25）时 Agent 工具执行被挂起，强制立即收束输出（总结已完成/未完成/偏移原因）；首次跨越发 `focusEscalation` 事件并计入 A.1 归因

## [Unreleased] — P2.5 进化能力（第三批）

### Added
- **Skill 注册表（A.3）**：`src/core/skills.ts`——`.workflow/skills/<id>.md`（JSON frontmatter + 正文，对齐社区 SKILL.md 习惯）；关键词触发自动匹配（中英文混合），命中的领域上下文注入分解；**胜率闭环**：工作流成败回写 uses/wins，样本 ≥5 且胜率 <50% 自动退役（`skillRetired` 事件）；**自动起草**：≥3 个相似成功目标且无 skill 覆盖时由 LLM 起草草稿（draft 状态 + `skillDraftProposed` 事件，HITL 激活后才生效，绝不静默上线）
- **回归评测集（A.4）**：`src/core/evalSuite.ts`——`.workflow/eval_suite/cases.json` 用例（file_exists / file_contains / command_succeeds 断言）；新 CLI 命令 `autocode eval [--label]`：跑全套用例、保留最近 20 次历史、与上一次运行对比输出**回归/改进清单**（出现回归时退出码 1，可直接进 CI）——提示词/规则/skill 变更的影子验证底座
- Eval 归因补全（A.5 部分）：`EvalRecord.skillId` 记录本次命中的 skill，per-skill 胜率可追溯

## [Unreleased] — P2.5 进化能力（第二批）

### Added
- **规则生命周期管理（A.2）**：`src/core/rules.ts`——`.workflow/rules.json` 结构化存储（id/域标签/命中计数/最近验证/状态），替代 append-only；新教训文本归一化去重合并；连续 N 个工作流未被相关域验证的规则进入待退役（`ruleRetirementProposed` 事件，HITL 归档/复活 API）；自动迁移旧 `project_rules.md`；持续渲染 md 保持旧读取方兼容
- **作用域上下文注入（C.3）**：子 Agent 不再全量注入 Project Memory，改为"通用规则 + 与任务描述域匹配的规则子集"（上限 12 条），降低 token 成本与上下文稀释；注入即计 hitCount 供 A.1 归因
- **项目知识库（C.4）**：`src/core/knowledge.ts`——`.workflow/knowledge/` 文档库（frontmatter 元数据、原子写、同题更新）；中英文混合词法检索（英文词项 + 中文双字滑窗）；Clarify Phase 的需求规格自动入库；新增 `query_knowledge` 内置工具——Agent 遇到不确定先查沉淀决策再行动
- `extractLessons` 升级：LLM 产出带域标签的结构化教训，经 RuleStore 去重入库

## [Unreleased] — P2.5 进化能力（第一批）

### Added
- **Eval 归因（A.1）**：`EvalRecord` 升级——per-task 明细（成功/错误数/干预次数）、Verifier 结构化验证报告（lint/type/冲突/语义问题计数）、规则集 hash、提示词版本号、E-Stop 标记；新增 `verificationReport` 事件；质量分公式修正为成功率 70% + 验证通过率 30%（缓存命中率不再计入质量）
- **需求澄清阶段（B）**：`src/core/orchestrator/clarifier.ts`——复杂模糊目标先做缺口评估（复杂度/模糊度/缺失维度/跨层架构），触发后用 `search_web` 调研同类产品与开源项目，生成带推荐项与依据的选项问卷；CLI select / Dashboard 问卷卡双通道 + auto 模式 + 5 分钟超时降级；答案固化为 `.workflow/requirements.md`（含未确认假设清单）注入分解上下文
- **专注度监控（C.1）**：`src/core/focus.ts`——消费 decomposer 的 isolatedFiles/sharedFiles 声明检测越界写入、同签名调用循环检测、空转检测；refocus 警告回灌 LLM；`focusIntervention` 进 Eval 归因、`focusUpdate` 实时推 Dashboard 任务卡（🎯 分数徽章）
- 新配置：`clarifyConfig`、`focusConfig`；Evaluator 新增 `dispose()`

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
