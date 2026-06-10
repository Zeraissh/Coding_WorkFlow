# 架构理解笔记 — Coding_WorkFlow 动态工作流系统

> 生成时间: 2025-07-18
> 角色: 高级资深工控机工程师
> 目的: 理解整体架构设计，梳理模块关系与数据流，识别设计与实现缺陷

---

## 一、系统全景图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           CLI 入口层                                     │
│  bin/autocode.cjs → src/index.ts (Commander)                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                               │
│  │  config  │  │   chat   │  │   run    │                               │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘                               │
│       │             │             │                                      │
│       ▼             ▼             ▼                                      │
│  ┌────────────────────────────────────────┐                             │
│  │        Dashboard Server (Express)       │  ← SSE 实时推送              │
│  │        http://localhost:3000            │                             │
│  └────────────────┬───────────────────────┘                             │
│                   │                                                      │
│                   ▼                                                      │
│  ┌────────────────────────────────────────┐                             │
│  │          Orchestrator (编排器)          │                             │
│  │  ┌──────────┐ ┌──────────┐ ┌────────┐  │                             │
│  │  │Decomposer│ │TemplateMgr│ │PluginMgr│ │                             │
│  │  └────┬─────┘ └──────────┘ └────────┘  │                             │
│  │       │                                 │                             │
│  │       ▼ Plan(goal, tasks, batches)      │                             │
│  │  ┌────────────────────────────┐        │                             │
│  │  │   asyncPool(5) 并发调度     │        │                             │
│  │  │   ┌───────┐ ┌───────┐     │        │                             │
│  │  │   │Agent 1│ │Agent N│ ... │        │                             │
│  │  │   └───┬───┘ └───┬───┘     │        │                             │
│  │  │       │         │         │        │                             │
│  │  │       ▼         ▼         │        │                             │
│  │  │   ┌──────────────────┐    │        │                             │
│  │  │   │ LLM Client       │    │        │                             │
│  │  │   │ (Anthropic/OpenAI│    │        │                             │
│  │  │   │  /DeepSeek)      │    │        │                             │
│  │  │   └──────────────────┘    │        │                             │
│  │  └────────────────────────────┘        │                             │
│  │                                        │                             │
│  │  跨切面服务 (通过单例注入):              │                             │
│  │  ┌─────────┐ ┌──────────┐ ┌─────────┐  │                             │
│  │  │ FS Lock │ │TokenBudget│ │ Memory  │  │                             │
│  │  └─────────┘ └──────────┘ └─────────┘  │                             │
│  │  ┌─────────────┐ ┌───────────────┐     │                             │
│  │  │StateManager │ │SnapshotManager│     │                             │
│  │  └─────────────┘ └───────────────┘     │                             │
│  └────────────────────────────────────────┘                             │
│                   │                                                      │
│                   ▼                                                      │
│  ┌────────────────────────────────────────┐                             │
│  │      Verifier (双轨验证器)              │                             │
│  │  ┌──────────────┐ ┌──────────────────┐ │                             │
│  │  │ AutoChecker  │ │ SemanticReviewer │ │                             │
│  │  │ (lint/tsc/   │ │ (LLM 语义审查)    │ │                             │
│  │  │  test/import)│ │                  │ │                             │
│  │  └──────────────┘ └──────────────────┘ │                             │
│  └────────────────────────────────────────┘                             │
│                   │                                                      │
│                   ▼                                                      │
│  ┌────────────────────────────────────────┐                             │
│  │  Git Commit + Snapshot Cleanup + HITL  │                             │
│  └────────────────────────────────────────┘                             │
├─────────────────────────────────────────────────────────────────────────┤
│                      前端 UI (React + Vite)                               │
│  ui/src/App.tsx — SSE 事件消费，看板展示，审批交互                         │
├─────────────────────────────────────────────────────────────────────────┤
│                     Python 辅助脚本 (虚拟串口等)                           │
│  virtual_serial.py, serial_bridge.py, data_forwarder.py                  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 二、核心模块职责与关系

### 2.1 Orchestrator (编排器) — `src/core/orchestrator.ts`

**职责**: 工作流的"大脑"，负责任务全生命周期管理。

**关键流程**:
1. 接收用户 `goal` → 调用 `Decomposer.decompose()` 生成 `Plan`
2. Fallback: 如果 Decomposer 失败 → `planWorkflowSimple()` (传统 LLM JSON 拆解)
3. 按 `parallelBatches` 拓扑分层，每层内部 `asyncPool(5)` 并发执行
4. 每批完成后调用 `TokenBudget.rebalance()` 动态重分配
5. 全部完成后调用 `Verifier.verifyAndSynthesize()`
6. 提取 Lessons → `extractLessons()`
7. HITL 审批 (如果有 diff)
8. Git commit + 清理

**依赖注入**:
- `Decomposer` (通过构造函数注入 `callLLM`)
- `TokenBudget` (单例)
- `FSLock` (单例)
- `StateManager` (实例化)
- `SnapshotManager` (实例化)
- `MCPRegistry` (单例)
- `PluginManager` / `TemplateManager` (实例化)
- `ToolRetriever` (实例化)
- `ProjectIndexer` (实例化用于 RAG)
- `Verifier` (实例化)

### 2.2 Decomposer (任务分解器) — `src/core/orchestrator/decomposer.ts`

**职责**: 智能拓扑分解，生成 `parallelBatches`。

**输出结构**:
```typescript
{
  subtasks: [{ id, description, estimatedComplexity, dependencies, isolatedFiles, sharedFiles }],
  parallelBatches: [[task, task], [task]],  // 拓扑分层
  warnings: []
}
```

**关键特性**:
- 评估每个任务 `estimatedComplexity` (1-10)
- 分析 `dependencies` 依赖关系
- 拓扑排序生成并行批次

### 2.3 SubAgent (子代理) — `src/core/agent.ts`

**职责**: 执行单个子任务的自主 Agent。

**执行循环**:
1. 构建系统提示词 (含 OS 环境、任务上下文、隔离/共享文件信息)
2. 注入 Builtin Tools + MCP Tools + Global MCP Tools
3. 调用 LLM (带工具回调)
4. 工具调用循环: LLM → tool_use → tool_result → LLM → ... (最多 25 次工具调用)
5. 记录 `AgentExecutionLog` (文件操作、Shell 命令、LLM 调用、错误)
6. 释放所有 FSLock + 断开 MCP 连接

**工具注入链路**:
```
BuiltinTools (7个) → MCP Tools (动态检索) → Global MCP Tools (全局注册)
     ↓                      ↓                        ↓
 toolExecutors Map   toolExecutors Map        toolExecutors Map
     ↓                      ↓                        ↓
     └──────────────────────┴────────────────────────┘
                            ↓
                   anthropicTools[]
                            ↓
                   askLLM(system, messages, tools, onToolCall)
```

### 2.4 Verifier (验证器) — `src/core/verifier.ts`

**职责**: 双轨制二阶验证。

**阶段 1 — AutoChecker (`src/core/verifier/autoChecker.ts`)**:
- 文件冲突检测 (多 Agent 写入同一文件)
- 接口一致性检查 (import/export 匹配)
- Lint 检查 (eslint)
- 类型检查 (tsc --noEmit)
- 测试运行 (vitest/jest)

**阶段 2 — SemanticReviewer (`src/core/verifier/semanticReviewer.ts`)**:
- 6 个审查维度: 逻辑正确性、异常处理、代码冗余、安全隐患、风格一致性、性能问题
- 使用便宜模型 (haiku/flash) 进行语义审查
- 输出结构化 `SemanticIssue[]`

**最终合成**: 将 AutoCheck 结果 + Semantic 问题 + 子任务结果 → 喂给 LLM 生成最终报告

### 2.5 LLM Client — `src/llm/client.ts`

**职责**: 多供应商 LLM 抽象层。

**支持的供应商**:
| 供应商 | SDK | 特性 |
|--------|-----|------|
| Anthropic | `@anthropic-ai/sdk` | Prompt Caching, 原生 tool_use |
| OpenAI | `openai` | Function calling |
| DeepSeek | `openai` (兼容) | 推理模式 (thinking) |

**关键设计**:
- 统一返回 Anthropic Message 格式
- `mapAnthropicToolsToOpenAI()` / `mapAnthropicMessageToOpenAI()` 格式转换
- `withRetry()` 指数退避重试 (致命错误 401/403/404 不重试)
- Token 使用上报到 `TokenBudget`
- DeepSeek `<thinking>` 标签保留处理

### 2.6 FSLock (文件锁) — `src/core/fslock.ts`

**职责**: 进程内文件级并发写锁。

**设计**:
- 写锁互斥 (同时只有一个 Agent 能写)
- 读锁共享 (不阻塞，记录访问者)
- Promise 排队机制 (等待队列)
- 超时熔断 (默认 30s，自动释放)
- 重入支持 (同一 Agent 重复请求同一文件)
- 冲突日志 (多 Agent 写入同一文件 → 记录供 Verifier 使用)
- `writeFile()` 封装 (验证锁持有者后才执行 `fs.writeFileSync`)

### 2.7 TokenBudget — `src/core/tokenBudget.ts`

**职责**: Token 预算追踪与智能分配。

**三级熔断**:
| 阈值 | 默认 | 行为 |
|------|------|------|
| warning | 70% | 发送提醒事件 |
| critical | 85% | 建议尽快输出结果 |
| exhaust | 95% | 强制终止 Agent |

**动态重分配算法**:
1. Agent 提前完成 → 计算 surplus (已分配 - 已消耗)
2. 找出同批次活跃 Agent
3. 按剩余分配额度比例分配 surplus
4. 零头入 freePool (后续任务可用)
5. `requestExtraBudget()` 可从 freePool 拨款

**预算初始化**:
- 总预算中预留 verifierReservePercent (默认 10%) 给 Orchestrator + Verifier
- 其余按 `estimatedComplexity` 权重分配到各子任务

### 2.8 Events (事件系统) — `src/core/events.ts`

**职责**: 进程内事件发布/订阅 (基于 Node.js EventEmitter)。

**事件清单**:
```
workflowStarted     → { goal, totalTasks }
taskStarted         → { taskId, description }
log                 → { taskId, message }
taskCompleted       → { taskId, result, success, agentId, executionLog }
approvalRequested   → { taskId, toolName, arguments, resolve, reject }
workflowCompleted   → { result, tokensSpent?, diff? }
reviewRequested     → { taskId, diff, finalOutput }
dashboardApproval   → { taskId, approved }
llmUsageReport      → { tokens, cachedTokens, calls }
previewUpdated      → (预留)
fileChanged         → (预留)
evalUpdated         → (预留)
```

### 2.9 Dashboard — `src/dashboard/server.ts`

**职责**: Web 监控仪表盘后端。

**端点**:
- `GET /` — 静态文件服务 (dashboard/public/index.html)
- `GET /workspace/*` — 工作区文件服务
- `GET /events` — SSE 实时事件流
- `POST /api/approve` — HITL 审批 + 规则提取
- `GET /api/eval` — 评估日志

**SSE 广播**: 所有 `workflowEvents` 事件 → 广播到所有已连接的 SSE 客户端

### 2.10 前端 UI — `ui/src/App.tsx`

**职责**: React 单页应用，消费 SSE 事件流。

**UI 组件结构**:
```
App
├── Header (标题 + HITL 开关)
├── Chat Input (目标输入框 + Launch 按钮)
├── Main Layout
│   ├── Sidebar
│   │   ├── Active Plugins Panel
│   │   └── Project Memory Panel
│   └── Kanban
│       ├── TaskCard[] (每个子任务一张卡片)
│       │   ├── Task Header (ID + 状态图标)
│       │   ├── Description
│       │   └── Task Logs (滚动日志)
│       └── Final Output Card (完成时显示)
│           ├── 合成文本
│           ├── Token 消耗
│           └── Diff 展示
└── Modal (审批弹窗)
```

---

## 三、完整数据流 (端到端)

```
                                      ┌──────────┐
                                      │   User   │
                                      └────┬─────┘
                                           │ goal: "修复串口 Bug"
                                           ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 1: CLI 入口                                                         │
│                                                                          │
│  src/index.ts:                                                           │
│    - 启动 DashboardServer(3000)                                           │
│    - new Orchestrator().executeWorkflow(goal)                             │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 2: 规划阶段 (Orchestrator.planWorkflow)                              │
│                                                                          │
│  ① TemplateManager.matchTemplate(goal) — 检查是否有匹配模板               │
│  ② ProjectIndexer.scanAndIndex() — 扫描项目文件建立索引                   │
│  ③ ProjectIndexer.search(goal) — RAG 检索相关代码                         │
│  ④ safeListDir() — 生成项目目录映射                                       │
│  ⑤ getProjectMemory() — 获取历史 Lessons                                  │
│  ⑥ Decomposer.decompose(goal, context) — LLM 智能拆解                    │
│     或 fallback → planWorkflowSimple(goal) — JSON 模式拆解                │
│                                                                          │
│  输出 Plan:                                                              │
│  { goal, tasks: [SubTask], parallelBatches: [[task,task],[task]],        │
│    warnings: [] }                                                        │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Git 分支 + 快照                                                   │
│                                                                          │
│  gitCreateBranch("autocode/task-{ts}-{goal}")                             │
│  snapshotManager.createSnapshot() — 文件系统快照备份                       │
│  stateManager.saveState(state) — 持久化状态 (断点续跑)                     │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 4: 全局初始化                                                        │
│                                                                          │
│  MCPRegistry.getInstance().init() — 加载外部 MCP 服务器工具               │
│  ToolRetriever.init() — 初始化向量存储，索引可用工具                       │
│  TokenBudget.allocateForTasks() — 按复杂度分配 Token 预算                  │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 5: 拓扑分批并行执行                                                  │
│                                                                          │
│  for each batch in parallelBatches:                                      │
│    asyncPool(5, batch, async (task) => {                                  │
│                                                                          │
│      ① retriever.getRelevantTools(task.description)                       │
│         → 返回 ToolRecord[] (含 MCP 注册信息)                              │
│                                                                          │
│      ② new SubAgent().execute(task, goal, tools)                          │
│         ├── 构建 systemPrompt (OS/上下文/隔离文件)                         │
│         ├── 注入 BuiltinTools (7个)                                       │
│         ├── 注入 MCP Tools (动态)                                         │
│         ├── 注入 Global MCP Tools                                         │
│         ├── TokenBudget.checkBudget() — 预算检查                          │
│         ├── askLLM() → 工具调用循环 (最多25次)                             │
│         │   ├── [Tool Call] → executeBuiltinTool() / mcpClient.callTool() │
│         │   │   ├── FSLock.acquireWrite() — 写操作前获取锁                 │
│         │   │   ├── 记录 AgentExecutionLog                                │
│         │   │   └── FSLock.release()                                      │
│         │   └── [Tool Result] → LLM 继续                                  │
│         ├── 上报 Token 消耗                                               │
│         └── 返回 TaskResult                                               │
│                                                                          │
│      ③ events.emit('taskCompleted', result)                               │
│      ④ TokenBudget.markCompleted(agentId)                                 │
│         → 触发 rebalance (盈余重分配)                                     │
│                                                                          │
│      return result;                                                       │
│    })                                                                     │
│                                                                          │
│    stateManager.saveState() — 每批完成保存状态                             │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 6: 验证与合成 (Verifier)                                             │
│                                                                          │
│  ① FSLock.getConflictLog() — 收集文件冲突                                 │
│                                                                          │
│  ② AutoChecker.check(agentLogs)                                          │
│     ├── detectFileConflicts() — 文件写入冲突检测                           │
│     ├── checkInterfaceConsistency() — import/export 一致性                │
│     ├── runLintCheck() — eslint                                          │
│     ├── runTypeCheck() — tsc --noEmit                                     │
│     └── runTests() — vitest/jest                                          │
│                                                                          │
│  ③ SemanticReviewer.review(agentLogs, autoCheckResult)                    │
│     ├── collectFileDiffs() — 收集变更文件                                  │
│     ├── buildReviewPrompt() — 构建6维度审查提示词                          │
│     ├── callLLM() (便宜模型) → 返回 SemanticIssue[]                        │
│     └── parseReviewResponse() — 解析结构化问题                             │
│                                                                          │
│  ④ LLM 最终合成                                                           │
│     ┌──────────────────────────────────────┐                             │
│     │ 输入: Plan + Results + AutoCheck +   │                             │
│     │       SemanticIssues                 │                             │
│     │ 输出: 连贯的最终文本 + 验证报告       │                             │
│     └──────────────────────────────────────┘                             │
└─────────────────────────────────────┬────────────────────────────────────┘
                                      │
                                      ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ STEP 7: 记忆提取 + HITL + Git                                             │
│                                                                          │
│  extractLessons(goal, agentLogs) — 提取经验教训 → project_rules.md        │
│  gitDiffCheck() — 检查变更                                                │
│  if (有变更) →                                                           │
│    events.emit('reviewRequested', { diff, finalOutput })                  │
│    events.on('dashboardApproval') → 等待用户审批                           │
│    if (!approved) → snapshotManager.rollback()                            │
│  gitCommitAll() — 提交到 Git                                              │
│  events.emit('workflowCompleted', { result, tokensSpent, diff })          │
│  stateManager.clearState()                                                │
│  snapshotManager.prune()                                                  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 四、关键设计模式

| 模式 | 应用位置 | 说明 |
|------|----------|------|
| **单例 (Singleton)** | FSLock, TokenBudget, MCPRegistry, GlobalConfig | 全局唯一状态管理 |
| **策略 (Strategy)** | LLM Client (Anthropic/OpenAI/DeepSeek) | 多供应商适配 |
| **观察者 (Observer)** | Events (EventEmitter) | 解耦日志/通知/UI |
| **模板方法 (Template)** | Orchestrator.executeWorkflow | 固定流程，可 resume |
| **责任链 (Chain)** | Verifier (AutoChecker → SemanticReviewer → LLM) | 递进式验证 |
| **对象池 (Pool)** | asyncPool | 并发限制 |
| **备忘录 (Memento)** | StateManager, SnapshotManager | 状态持久化与回退 |
| **适配器 (Adapter)** | mapAnthropicToolsToOpenAI | 跨供应商工具格式转换 |

---

## 五、消息流路径总结

```
User Goal
    │
    ▼
[CLI] → Orchestrator.planWorkflow()
    │       │
    │       ├── Decomposer.decompose() → LLM (temperature=0.3)
    │       │        │
    │       │        └── Plan { goal, tasks[], parallelBatches[][] }
    │       │
    │       └── planWorkflowSimple() [fallback] → LLM (temperature=0.7)
    │                │
    │                └── JSON 解析 → Plan
    │
    ▼
Orchestrator.executeWorkflow()
    │
    ├── gitCreateBranch()
    ├── snapshotManager.createSnapshot()
    ├── MCPRegistry.init()
    ├── ToolRetriever.init()
    ├── TokenBudget.allocateForTasks()
    │
    ├── for each batch in parallelBatches:
    │   │
    │   ├── asyncPool(5, batch, task → SubAgent.execute())
    │   │   │
    │   │   ├── BuiltinTools injected
    │   │   ├── MCP Tools injected (per task)
    │   │   ├── Global MCP Tools injected
    │   │   │
    │   │   ├── askLLM() with tool callback
    │   │   │   ├── [tool_use] → executeBuiltinTool() / mcpClient.callTool()
    │   │   │   │   ├── FSLock.acquireWrite()
    │   │   │   │   ├── fs.writeFileSync()
    │   │   │   │   └── FSLock.release()
    │   │   │   └── [tool_result] → LLM continues
    │   │   │
    │   │   └── returns TaskResult + AgentExecutionLog
    │   │
    │   ├── TokenBudget.rebalance()
    │   └── stateManager.saveState()
    │
    ├── Verifier.verifyAndSynthesize(plan, results, agentLogs)
    │   ├── AutoChecker.check(agentLogs)
    │   │   ├── detectFileConflicts()
    │   │   ├── checkInterfaceConsistency()
    │   │   ├── runLintCheck() → npx eslint
    │   │   ├── runTypeCheck() → npx tsc --noEmit
    │   │   └── runTests() → npx vitest
    │   ├── SemanticReviewer.review(agentLogs) → LLM (cheap model)
    │   └── LLM synthesis → final output text
    │
    ├── extractLessons() → project_rules.md
    ├── gitDiffCheck() → diff
    ├── HITL: events.emit('reviewRequested') → wait for dashboardApproval
    │   ├── approved → continue
    │   └── rejected → snapshotManager.rollback()
    ├── gitCommitAll()
    └── events.emit('workflowCompleted')
```

---

## 六、UI 位置与渲染流程

### 6.1 Dashboard 前端 (`ui/src/App.tsx`)

**状态管理**: React `useState` + SSE `EventSource`

**UI 区块**:

| 区块 | 位置 | 绑定事件 | 说明 |
|------|------|----------|------|
| Header | 顶部固定 | — | 标题 + HITL 开关 |
| Chat Input | Header 下方 | — | goal 输入 + Launch 按钮 |
| Plugins Panel | 左侧边栏上 | — | 从 `/api/config` 加载 |
| Memory Panel | 左侧边栏下 | — | 从 `/api/config` 加载 |
| Task Kanban | 中央主区域 | `taskStarted`, `log`, `taskCompleted` | 动态增删任务卡片 |
| Final Output | Kanban 底部 | `workflowCompleted` | 合成结果 + Token + Diff |
| Approval Modal | 全屏浮层 | `approvalRequested` | 审批弹窗 |

### 6.2 Dashboard HTML (`src/dashboard/public/index.html`)

另一套静态仪表盘 (与 React UI 并存但独立)，用于更基础的监控。

### 6.3 CLI 交互式界面 (`src/cli/interactive.ts`)

使用 `@clack/prompts` 提供字符终端内的交互式体验。

---

## 七、数据存储位置

| 数据 | 存储位置 | 格式 |
|------|----------|------|
| LLM 配置 | `~/.workflow_config.json` | JSON |
| 项目记忆 | `.workflow/project_rules.md` | Markdown |
| 工作流状态 | `.workflow/state.json` | JSON |
| 文件快照 | `.workflow/snapshots/snap_{ts}/` | 文件副本 |
| MCP 配置 | `.workflow/mcp_config.json` | JSON |
| 插件 | `.workflow/plugins/*.js` | JavaScript |
| 向量索引 | `.workflow/vector_store/` | HNSWLib |
| Git 分支 | `autocode/task-{ts}-{goal}` | Git ref |

---

## 八、关键数据模型

### SubTask
```typescript
{
  id: string;                    // e.g. "task_1"
  description: string;           // 子任务描述
  expectedOutput: string;        // 预期产出
  estimatedComplexity?: number;  // 1-10, 用于 Token 分配
  dependencies?: string[];       // 依赖的子任务 ID
  isolatedFiles?: string[];      // 独占写入文件
  sharedFiles?: string[];        // 共享只读文件
}
```

### AgentExecutionLog
```typescript
{
  agentId: string;
  subtaskId: string;
  files: AgentFileOp[];          // 文件读写操作记录
  shellCommands: string[];       // 执行的 Shell 命令
  llmCalls: number;              // LLM 调用次数
  tokensUsed: number;            // Token 消耗
  errors: string[];              // 错误信息
}
```

### TaskResult
```typescript
{
  taskId: string;
  result: string;                // LLM 输出文本
  success: boolean;
  error?: string;
  agentId?: string;
  executionLog?: AgentExecutionLog;
}
```

---

## 九、内建工具清单

| 工具名 | 函数 | 说明 |
|--------|------|------|
| `read_file` | 读取文件内容 | 带行号输出 |
| `write_file` | 写入文件 | 自动创建目录，FSLock 保护 |
| `run_terminal_command` | 执行终端命令 | 基于平台选择 shell |
| `list_dir` | 安全列出目录 | 忽略 node_modules/隐藏目录 |
| `search_web` | 网络搜索 | 占位实现 |
| `semantic_code_search` | 语义代码搜索 | 基于本地向量搜索 |
| `grep_search` | 文本模式搜索 | 基于正则的文件搜索 |

---

## 十、架构亮点总结

1. **分层清晰**: CLI → Orchestrator → Agent → LLM，每层职责明确
2. **容错健壮**: 指数退避重试、JSON 解析 fallback、快照回滚、断点续跑
3. **并发安全**: FSLock (写互斥) + asyncPool (限流) + TokenBudget (熔断)
4. **多供应商**: 统一接口适配 Anthropic/OpenAI/DeepSeek
5. **双轨验证**: 规则检查 + LLM 语义审查
6. **可观测性**: 事件系统 + SSE 推送 + Dashboard + AgentExecutionLog
7. **HITL**: 终端命令审批 + 变更审批 (Git diff)
8. **持续学习**: Lessons 提取 → project_rules.md → 下次工作流注入

---

> **注**: 本文档仅描述架构现状，不包含设计缺陷分析。缺陷将在独立评估报告中输出。
