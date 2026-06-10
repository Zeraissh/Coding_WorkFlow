# 🔴 整体设计缺陷报告（工控机工程师视角）

> **审查日期**：2025-07-18  
> **审查范围**：全系统（UI 前端 `ui/src/`、Dashboard `src/dashboard/`、SSE 事件系统 `src/core/events.ts`、API 服务 `src/server/index.ts`、数据转发 `data_forwarder.py`、串口桥接 `serial_bridge.py`）  
> **审查标准**：工业控制 PC 系统设计规范 —— 实时性、可靠性、可恢复性、人机工程、报警管理、操作审计  
> **审查人角色**：高级资深工控机工程师（10+ 年工控领域经验）

---

## 📊 缺陷总览

| 类别 | 缺陷数 | 🔴 Critical | 🟠 High | 🟡 Medium | 🔵 Low |
|------|--------|-------------|---------|-----------|--------|
| 1. 系统架构与可靠性 | 8 | 4 | 3 | 1 | 0 |
| 2. UI 与 HMI 人机界面 | 12 | 3 | 6 | 3 | 0 |
| 3. 消息通知机制 | 9 | 4 | 4 | 1 | 0 |
| 4. 渲染与性能 | 6 | 1 | 3 | 2 | 0 |
| 5. 数据与状态管理 | 5 | 2 | 2 | 1 | 0 |
| 6. 安全性与会话审计 | 4 | 3 | 1 | 0 | 0 |
| **合计** | **44** | **17** | **19** | **8** | **0** |

---

## 1. 系统架构与可靠性缺陷

### 1.1 🔴 SSE 单点故障 — 无重连、无心跳、无降级

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:67` | `new EventSource(...)` 无 `onerror` 回调 |
| `src/dashboard/public/index.html:174` | `new EventSource('/events')` 无重连逻辑 |
| `src/dashboard/server.ts:28` | Dashboard SSE 端点无心跳保活 |
| `src/server/index.ts:67` | API SSE 端点同样无心跳 |

**工控视角分析**：  
在工厂环境中，网络抖动、电磁干扰（EMI）导致 SSE 断开是常态。当前实现中，一旦 `EventSource` 连接断开，整个前端将进入"静默失效"状态——界面停留在最后一帧数据，操作员完全不知道系统已离线。**对于工控系统这是致命的**：操作员可能基于过期数据做出错误判断。

**改进建议**：
- 实现 EventSource 自动重连（指数退避，初始 1s，最大 30s）
- 服务端每 15s 发送 `:heartbeat\n\n` 注释帧保持连接
- 前端实现连接状态指示灯（绿/黄/红三色）
- 断开超过 30s 触发视觉+声音告警

---

### 1.2 🔴 服务端单进程架构 — 无守护进程、无看门狗

| 位置 | 问题 |
|------|------|
| `src/server/index.ts:119` | `app.listen(3000, ...)` — 进程崩溃 = 服务全停 |
| `src/dashboard/server.ts:115` | Dashboard 同上 |

**工控视角分析**：  
`node server.js` 作为一个前台进程运行，一旦发生未捕获异常（如 OOM、端口占用），整个系统直接宕机。工控机通常 7×24 运行，**绝不允许**单点进程故障导致产线停摆。

**改进建议**：
- 使用 `pm2` 或 Windows Service Wrapper 注册为系统服务，配置自动重启
- 实现进程级健康检查端点 `/health`（被外部 watchdog 轮询）
- 关键路径加 `try/catch` 并写入持久化错误日志
- 考虑主备双进程热切换（Active-Standby）

---

### 1.3 🔴 工作流无紧急停止（E-Stop）机制

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx` 全局 | 无"紧急停止"按钮 |
| `src/core/orchestrator.ts` | `executeWorkflow()` 无取消令牌（CancellationToken） |
| `src/core/agent.ts` | SubAgent 循环中无中断检查点 |

**工控视角分析**：  
工业控制系统有一条铁律：**任何自动化操作必须可被人类随时中断**。当前系统中，一旦 `executeWorkflow()` 启动，它将以不可阻挡的方式执行完所有批次。如果 Agent 误删文件、执行危险 Shell 命令，操作员只能眼睁睁看着或强制 kill 进程——后者会导致状态不一致。

**改进建议**：
- Orchestrator 注入 `AbortController`，在每批次之间检查 `signal.aborted`
- `ui/src/App.tsx` 添加显眼的红色"紧急停止"按钮（物理尺寸 ≥ 60×60px）
- E-Stop 触发后：停止所有 SubAgent → 回滚快照 → 广播状态变更
- SubAgent 的 `MAX_TOOL_CALLS` 循环中增加 `abortSignal` 检查

---

### 1.4 🔴 Python 串口模块在 Windows 上不可用

| 位置 | 问题 |
|------|------|
| `serial_bridge.py` | 依赖 `termios`、`fcntl` — Windows 不存在的 Unix 模块 |
| `data_forwarder.py` | `pyserial` 为可选依赖，缺失时抛 `ImportError` |
| `tests/test_bridge.py` | 7/130 测试因 Windows 兼容性失败 |

**工控视角分析**：  
大量工控机运行 Windows（尤其是与西门子、倍福 PLC 配套的工控面板）。`serial_bridge.py` 作为连接物理串口设备的关键桥梁，在 Windows 上完全无法运行。这意味着**整个系统的硬件对接能力在主要工控平台上归零**。

**改进建议**：
- Windows 上使用 `pywin32` + `com0com` 替代 `pty`/`termios`
- 所有串口操作统一抽象为 `ISerialPort` 接口，运行时根据 OS 选择实现
- 添加启动时平台检测与兼容性报告

---

### 1.5 🟠 EventEmitter 内存泄漏风险

| 位置 | 问题 |
|------|------|
| `src/core/events.ts:3` | `new EventEmitter()` 默认最大监听器 10 个 |
| `src/server/index.ts:29-33` | 每个 SSE 事件注册一个监听器，未设上限 |
| `src/dashboard/server.ts:103-111` | `setupListeners()` 一次性注册 9 个监听器 |

**工控视角分析**：  
在长时间运行的工控系统中，事件监听器的累积可能导致内存泄漏。`EventEmitter` 在超过默认限制时会打印警告，但不会阻止注册——在有大量 SSE 客户端重连的场景下可能导致内存持续增长。

**改进建议**：
- 设置 `workflowEvents.setMaxListeners(50)` 并监控实际监听器数量
- SSE 广播改为遍历 `clients[]` 而非每个 client 注册独立事件监听
- 定期（每 1h）输出监听器计数到日志

---

### 1.6 🟠 文件锁超时后的行为未定义

| 位置 | 问题 |
|------|------|
| `src/core/fslock.ts` | 文件锁等待超时后的降级策略不清晰 |
| `src/core/agent.ts:198` | `fslock().releaseAll(this.agentId)` 放在 `finally` 中有可能死锁 |

**工控视角分析**：  
多 Agent 并发写同一文件时，如果某个 Agent 持有锁后崩溃（未执行 `finally`），该文件将永久锁定。虽然 `fslock` 有超时机制，但超时后是抛错还是强制释放没有明确定义。

**改进建议**：
- 实现锁的 TTL（Time-To-Live）机制，超时自动释放
- 锁状态持久化到 `.workflow/locks.json`，进程重启后可恢复/清理
- 添加死锁检测：定期扫描持有超时的锁并自动释放

---

### 1.7 🟠 LLM API 不可用时的降级路径单薄

| 位置 | 问题 |
|------|------|
| `src/core/agent.ts:135` | LLM 调用失败 → 直接抛错返回 `success: false` |
| `src/core/orchestrator.ts:130` | Decomposer 失败 → fallback 到简单拆解，但简单拆解仍依赖 LLM |

**工控视角分析**：  
工控环境可能运行在离线/气隙网络中。如果 LLM API（OpenAI/Anthropic/DeepSeek）全部不可达，整个"动态工作流"核心能力完全丧失。系统应当有本地规则引擎作为最低降级路径。

**改进建议**：
- 增加"离线模式"：基于预置模板 + 本地规则引擎执行（`TemplateManager` 已存在，可扩展）
- API 不可用时 UI 显示明确的大字提示："LLM 服务不可用，系统运行于离线模式"
- 离线模式下禁用需要 LLM 的功能，但保留 Dashboard 监控和手动操作能力

---

### 1.8 🟡 Node.js `EventEmitter` vs `EventTarget` 不一致

| 位置 | 问题 |
|------|------|
| `src/core/events.ts` | 使用 Node.js `EventEmitter`（`.on()`/`.emit()`） |
| `ui/src/App.tsx` | 浏览器端使用 `EventSource`（`.addEventListener()`） |

两套事件模型命名和语义不同（`.on()` vs `.addEventListener()`，`emit` vs `dispatchEvent`），在跨端调试时增加心智负担。

---

## 2. UI 与 HMI 人机界面缺陷

### 2.1 🔴 无全局报警管理系统（ISA-18.2 标准缺失）

| 位置 | 问题 |
|------|------|
| 全部 UI 文件 | **完全不存在**报警列表、报警确认、报警分级、报警历史 |

**工控视角分析**：  
ISA-18.2（报警管理国际标准）要求：
- 报警按优先级分 4 级（Critical / High / Medium / Low）
- 报警须可确认（Acknowledge）、可搁置（Shelve）
- 报警历史须可追溯、可导出
- 报警触发后须有声音+视觉双重提示

当前系统中，所有问题通过 `console.error` 或 `appendLog()` 淹没在通用日志中。操作员无法区分"文件写入失败"和"LLM 扣费即将超限"的紧迫性差异。

**改进建议**：
- 在 UI 顶部添加常驻报警条（Alarm Banner），按严重程度着色和排序
- Dashboard 右侧面板增加独立"Alarms"标签页
- 实现报警声音（Web Audio API，不同级别不同音调）
- 所有报警写入 `.workflow/alarms.jsonl` 持久化

---

### 2.2 🔴 React Error Boundary 缺失 — 单点崩溃白屏

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx` | 根组件无 `<ErrorBoundary>` 包裹 |
| `ui/src/main.tsx` | 渲染入口同样无保护 |

**工控视角分析**：  
在 React 中，任何未捕获的渲染异常都会导致整个组件树卸载 → 白屏。对于操作员来说，这意味着"系统死了"——尽管后端可能仍在正常运行。**工控 HMI 白屏是不可接受的**。

**改进建议**：
- 实现 `ErrorBoundary` 组件，捕获渲染错误后显示"系统异常，请刷新"降级 UI
- 降级 UI 包含：刷新按钮、错误时间戳、后台状态摘要
- ErrorBoundary 触发时自动尝试重连 SSE

---

### 2.3 🔴 关键操作无二次确认 — 误触风险

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:103` | `handleApprove(false)` — Reject 直接生效 |
| `ui/src/App.tsx:49` | `startWorkflow()` — Enter 键直接触发 |
| `src/dashboard/public/index.html:298` | `submitReview(false)` — 同上 |

**工控视角分析**：  
工控触摸屏在震动环境下极易误触。拒绝审批、启动工作流这类不可逆操作，**必须**有二次确认对话框（带 2~3 秒倒计时更佳）。

**改进建议**：
- 所有破坏性操作增加确认对话框（Modal + 倒计时按钮）
- `startWorkflow` 增加 `goal.trim().length < 10` 时的确认提示（目标太短可能不完整）
- 确认按钮默认聚焦在"取消"而非"确认"

---

### 2.4 🟠 暗色主题在强光车间不可用

| 位置 | 问题 |
|------|------|
| `ui/src/index.css:1-8` | `:root` 仅定义暗色主题变量 |
| `ui/src/index.css:2` | `--bg-color: #0f172a` 深蓝黑背景 |

**工控视角分析**：  
工厂车间通常在强光（>1000 lux）环境下，暗色主题会导致屏幕内容难以辨认。工控 HMI 标准推荐**高对比度亮色主题**（如黑字白底），部分场景还需要**日光可读模式**（高对比度 + 大字体）。

**改进建议**：
- 增加亮色/暗色主题切换开关（持久化到 `localStorage`）
- 亮色主题使用 `#ffffff` 背景 + `#1a1a1a` 前景 + ≥ 7:1 对比度
- 增加"高对比度模式"（WCAG AAA 标准）

---

### 2.5 🟠 触摸目标尺寸不达标（< 48×48px）

| 位置 | 元素 | 实际尺寸 | 标准要求 |
|------|------|----------|----------|
| `ui/src/index.css:53` | `.toggle` 开关 | 40×24px | ≥ 48×48px |
| `ui/src/index.css:119` | `.task-status` 标签 | padding 0.25rem | ≥ 48×48px 触摸区 |
| `src/dashboard/public/index.html` | `.file-pill` | padding 2px 6px | 极小 |
| `src/dashboard/public/index.html` | `.log-controls button` | padding 4px 8px | 极小 |

**工控视角分析**：  
工控操作员通常戴防护手套操作触摸屏。ISO 9241-410 要求触摸目标 ≥ 12mm（约 48px @ 96dpi）。当前 UI 中大量交互元素远小于此标准，戴手套几乎无法准确点击。

**改进建议**：
- 全局 `.button, .toggle, .clickable` 最小尺寸设为 48×48px
- 使用 `@media (pointer: coarse)` 为触摸设备放大交互区域
- 交互元素之间保持 ≥ 8px 间距防止误触

---

### 2.6 🟠 无键盘导航支持（焦点样式完全缺失）

| 位置 | 问题 |
|------|------|
| `ui/src/index.css` 全局 | 无 `:focus-visible` 样式（仅 `App.css` 的 `.counter` 有） |
| `src/dashboard/public/index.html` | **全页面零** `:focus` / `:focus-visible` 样式 |
| `ui/src/App.tsx:178-196` | 审批 Modal 无焦点陷阱（Tab 可逃逸到背景元素） |

**工控视角分析**：  
许多工控面板配有物理键盘（或数字小键盘）。失去键盘导航支持意味着操作员必须伸手触摸屏幕——在需要频繁操作的生产线上，这会降低效率并增加疲劳。

**改进建议**：
- 全局添加 `:focus-visible` 样式（2px 蓝色轮廓）
- 审批 Modal 实现焦点陷阱（Tab 在 Modal 内循环）
- 为高频操作添加快捷键（Enter=确认, Esc=取消, F5=刷新）

---

### 2.7 🟠 UI 与 Dashboard 两套界面并存 — 功能割裂

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx` | React SPA — 偏向"聊天式"交互 |
| `src/dashboard/public/index.html` | 原生 HTML+JS — 偏向"监控式"面板 |

两套 UI 通过不同的 SSE 端点连接，有大量重复逻辑（日志渲染、任务状态管理、审批处理），但在功能上不重叠且风格迥异。操作员需要学习两套界面，增加培训成本。

**改进建议**：
- 统一为单一 React 应用，Dashboard 作为其中的一个 Tab/View
- 或明确分工：React SPA 用于开发/调试，Dashboard 用于生产监控
- 两者共享 SSE 事件处理 Hook

---

### 2.8 🟠 审批 Modal 仅显示第一个请求 — 并发审批丢失

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:183` | `approvals[0]` — 始终只取第一个 |
| `ui/src/App.tsx:196` | `approvals[0].reqId` — 同上 |

**工控视角分析**：
当多个 SubAgent 同时请求审批（如 Agent A 要写文件 X，Agent B 要执行命令 Y），操作员只能看到第一个请求。其余请求被隐藏，可能导致：
- 操作员以为只有一个审批 → 批准后发现还有更多操作
- 被隐藏的审批请求可能因超时而自动拒绝

**改进建议**：
- 将 `approvals` 数组渲染为队列列表（FIFO）
- 每个审批请求显示序号 "1/3"
- 支持"全部批准"批量操作（需二次确认）

---

### 2.9 🟡 全局状态摘要缺失 — 操作员无法"一览"

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx` | 无 Dashboard 首页 — 直接显示输入框和 Kanban |
| `src/dashboard/public/index.html` | 仅有 Token 和 Retention Score 两个指标 |

**工控视角分析**：
工控 HMI 的第一原则是"Situation Awareness at a Glance"（一览式态势感知）。操作员应在 2 秒内回答：
- 系统是否正常运行？
- 当前在执行什么？
- 是否有异常？

当前系统完全没有这个能力。

**改进建议**：
- 顶部固定状态栏：系统心跳指示灯 🟢🟡🔴 + 运行时长 + 当前任务数
- 关键指标仪表盘：Token 消耗表盘、文件变更计数器、Agent 状态矩阵
- 异常情况红色闪烁边框（整个页面级视觉提示）

---

### 2.10 🟡 字体大小不适于工业远距离观看

| 位置 | 元素 | 字号 |
|------|------|------|
| `ui/src/index.css:138` | `.task-logs` | `0.85rem` |
| `ui/src/index.css:122` | `.task-status` | `0.8rem` |
| `src/dashboard/public/index.html` | `.log-box` | `0.85rem` |

工控屏通常在 0.5m~1m 距离观看，字号应 ≥ `1rem`（16px）。日志等次要信息可稍小，但状态标识必须醒目。

---

### 2.11 🟡 内联样式泛滥 — 维护与调整困难

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:113-197` | 大量 `style={{...}}` 硬编码 |
| `src/dashboard/public/index.html` | `<style>` 块与内联 `style="..."` 混用 |

**工控视角分析**：
工控场景下经常需要调整 UI 以适应不同分辨率的工控面板（1024×768、1280×800、1920×1080）。内联样式分散在各处，统一调整（如"把所有字体放大 20%"）几乎不可能。

**改进建议**：
- 迁移到 CSS Modules 或 Tailwind CSS
- 所有尺寸使用 CSS 变量（`--font-size-base`、`--spacing-unit`）驱动
- 支持通过单个 CSS 变量缩放全局 UI

---

### 2.12 🟡 缺乏数据可视化组件

| 位置 | 问题 |
|------|------|
| 全局 | 完全无趋势图、进度条、仪表盘、饼图 |

所有数据以文本/列表呈现。Token 消耗趋势、任务完成率、文件变更分布等信息如果以图表呈现，操作员能更快识别异常模式。

---

## 3. 消息通知机制缺陷

### 3.1 🔴 全局无 Toast/通知组件 — 错误静默丢失

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:30` | `fetch(...).catch(console.error)` — 用户零感知 |
| `ui/src/App.tsx:39` | 同上 |
| `ui/src/App.tsx:67` | SSE `onerror` 回调完全缺失 |

**工控视角分析**：
`console.error` 在工控面板上不可见（无 DevTools），这意味着所有 API 错误对操作员是**完全不可见的**。操作员可能持续等待一个已经失败的请求，导致：
- 生产数据未同步
- 审批请求未送达
- 系统实际已部分宕机

**改进建议**：
- 实现 Toast 通知系统（右上角弹出，3 级：Info/Warning/Error）
- Error 级 Toast 需手动关闭（不自动消失）
- 所有 `fetch` 调用统一经过 `apiClient` 包装，集中错误处理
- Toast 队列上限 5 条，超过后合并为 "还有其他 N 条通知"

---

### 3.2 🔴 日志级别分类过于粗糙

| 位置 | 问题 |
|------|------|
| `src/dashboard/public/index.html:392` | 仅通过字符串匹配 `'error'`/`'fail'` 判断日志级别 |
| `ui/src/App.tsx` | 日志完全无级别 — 所有 `log-entry` 同一样式 |

**工控视角分析**：
一个 LLM 返回的文本包含 "error" 单词（如 "please check if there is an error in..."）会被误标为警告。同时，真正严重的系统错误（如文件写入失败）和普通信息混在一起。

**改进建议**：
- 服务端发出 `log` 事件时携带 `level` 字段（`debug`/`info`/`warn`/`error`/`critical`）
- 前端根据 `level` 渲染不同样式（Error 红色加粗、Critical 红色闪烁）
- Dashboard 日志过滤器支持按级别筛选

---

### 3.3 🔴 无声音报警

**工控视角分析**：
在嘈杂的工厂环境中，操作员可能背对屏幕或正在操作其他设备。**视觉提示必须辅以声音报警**。ISA-18.2 明确要求 Critical 报警必须有声音提示。

**改进建议**：
- Critical 事件触发时播放报警音（Web Audio API，可选不同音调区分级别）
- 报警音在操作员确认后停止
- 提供"静音"按钮（临时静音 5 分钟，之后自动恢复）

---

### 3.4 🔴 审批流程无超时处理

| 位置 | 问题 |
|------|------|
| `src/server/index.ts:44` | `pendingApprovals` Map 无 TTL 清理 |
| `ui/src/App.tsx:178` | 审批 Modal 无倒计时/超时提示 |

**工控视角分析**：
操作员可能因紧急事务离开工位，审批请求如果无限等待，会导致整个 Workflow 挂起。系统中没有审批超时机制——`pendingApprovals` Map 中的 Promise 永远不会 resolve/reject。

**改进建议**：
- 审批请求 5 分钟后自动超时，默认行为为"拒绝"（安全优先原则）
- Modal 显示倒计时 "剩余 4:32"
- 超时的审批请求从 `pendingApprovals` 中清理并记录日志

---

### 3.5 🟠 通知无持久化 — 刷新即丢失

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx` | 所有状态在 `useState` 中 — 刷新后消失 |
| `src/dashboard/public/index.html` | `logEntries[]` 和 `tasks Map` 同样 |

**工控视角分析**：
工控机可能因断电、系统更新等原因重启。操作员重启后应能看到：
- 断电前最后的系统状态
- 未处理的报警列表
- 正在执行的任务状态

当前系统所有状态都是内存态，刷新即丢失。

**改进建议**：
- 关键状态持久化到 `localStorage`（审批队列、任务列表、最后 100 条日志）
- 服务端通过 StateManager 持久化 Workflow 状态（已有基础，需补 UI 端恢复逻辑）
- 重新连接后自动回放 `history`（Dashboard 已实现，React UI 未实现）

---

### 3.6 🟠 无通知分级聚合 — "告警风暴"

**工控视角分析**：
当系统出现级联故障（如 LLM API 断开 → 所有 Agent 失败 → 每个 Agent 产出 3 条错误日志），操作员会被瞬间涌入的大量通知淹没——这被称为"告警风暴"。工控系统要求告警聚合和抑制。

**改进建议**：
- 相同类型的连续告警合并为一条 "错误 X 已发生 N 次"
- 子告警（由根因触发的后续告警）折叠显示
- 告警风暴检测：1 分钟内超过 20 条告警 → 触发"告警风暴"提示并暂停新告警

---

### 3.7 🟠 SSE 事件无序列号 — 消息丢失不可检测

| 位置 | 问题 |
|------|------|
| `src/dashboard/server.ts:94-99` | `broadcast()` 无事件 ID |
| `src/server/index.ts:60-63` | `broadcastSSE()` 无 `id:` 字段 |

SSE 协议支持 `id:` 字段用于断线重连时的 `Last-Event-ID`。当前实现未设置，重连后无法知道丢失了哪些事件。

**改进建议**：
- 每个事件分配递增序列号，写入 `id:` 字段
- 客户端重连时发送 `Last-Event-ID` header
- 服务端根据 `Last-Event-ID` 从 `history` 中重放遗漏事件

---

### 3.8 🟡 SSE `history` 数组无上限 — 内存泄漏风险

| 位置 | 问题 |
|------|------|
| `src/dashboard/server.ts:13` | `private history: any[] = []` — 无上限 |
| `src/dashboard/server.ts:95` | `this.history.push(event)` — 持续增长 |

在长时间运行的工作流中（数千条日志），`history` 数组持续增长可能导致内存压力。

**改进建议**：
- `history` 上限设为 1000 条（环形覆盖）
- 或基于时间窗口（保留最近 1 小时）

---

## 4. 渲染与性能缺陷

### 4.1 🔴 日志全量渲染 — 无虚拟滚动

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:150` | `task.logs.map(...)` 直接映射全量日志 |
| `src/dashboard/public/index.html:206` | `renderLogs()` 每次 `innerHTML` 全部重写 |

**工控视角分析**：
一个典型工作流可能产生 5000+ 条日志（每个 Agent 的工具调用 + 系统日志）。在低性能工控机（如 Atom/Celeron 处理器）上，全量渲染 5000 个 DOM 节点会导致：
- 界面卡顿（>500ms 帧延迟）
- 触摸响应迟钝
- 浏览器内存占用飙升

**改进建议**：
- 使用虚拟滚动库（如 `react-window`、`@tanstack/virtual`）
- 日志渲染上限设为 200 条可见 + 虚拟滚动
- 提供"导出完整日志"按钮（下载为 .txt）

---

### 4.2 🟠 CSS 动画在低性能 GPU 上可能掉帧

| 位置 | 问题 |
|------|------|
| `ui/src/index.css:163-177` | `slideUp`、`fadeIn`、`scaleUp` 动画 |
| `ui/src/index.css:76-81` | `.toggle::after` 的 `transition: all 0.3s` |

**工控视角分析**：
工控一体机通常使用集成显卡（Intel UHD Graphics），驱动支持不完善。CSS `backdrop-filter: blur()` 和大量 `transform` 动画在低端 GPU 上会严重掉帧，甚至导致整个页面闪烁。

**改进建议**：
- 增加 `prefers-reduced-motion` 媒体查询支持
- 将 `backdrop-filter: blur(10px)` 替换为 `background: rgba(...)`（静态模糊）
- 限制同时播放的动画数量（≤ 3 个）

---

### 4.3 🟠 嵌套滚动容器 — 触摸体验差

| 位置 | 问题 |
|------|------|
| `ui/src/index.css:104` | `.kanban` 的 `overflow-y: auto` |
| `ui/src/index.css:137` | `.task-logs` 的 `overflow-y: auto; max-height: 200px` |
| `ui/src/index.css:24` | `.app-container` 的 `height: 100vh` |
| `src/dashboard/public/index.html` | `.panel` + `.task-list` + `.log-box` 三层嵌套滚动 |

三层嵌套滚动区域在触摸设备上表现为：用户在日志区滑动 → 外层面板也滑动 → 最终不知道该滚动哪个。这在需要快速定位信息的产线操作中非常恼人。

**改进建议**：
- 减少嵌套滚动层级 → 至多 1 层
- 触摸设备上禁用 `overscroll-behavior: contain`
- 提供"展开日志"按钮将日志放大到全屏

---

### 4.4 🟡 固定宽度布局不兼容多分辨率

| 位置 | 问题 |
|------|------|
| `ui/src/index.css:18` | `max-width: 1200px` 固定 |
| `src/dashboard/public/index.html` | `grid-template-columns: 350px 1fr 400px` 固定 |
| `ui/src/App.tsx:113-114` | `flex: '0 0 300px'` 硬编码 |

主流工控面板分辨率：1024×768、1280×800、1366×768、1920×1080。1200px 容器的设计在 1024×768 面板上会产生水平滚动条。

**改进建议**：
- 使用 `clamp()` 和百分比布局替代固定宽度
- 增加响应式断点（1024px / 1280px / 1920px）
- 在 1024×768 下侧边栏自动折叠

---

### 4.5 🟡 `marked` CDN 依赖 — 离线不可用

| 位置 | 问题 |
|------|------|
| `src/dashboard/public/index.html:6` | `<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js">` |

工控环境可能完全离线。CDN 依赖在网络断开时导致 Markdown 渲染失败。

**改进建议**：
- 将 `marked` 打包到本地或预编译为静态资源
- 或优雅降级为纯文本显示

---

### 4.6 🟡 无请求去抖/节流 — 高频事件导致过度渲染

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:72-77` | 每个 `log` SSE 事件触发一次 `setTasks`（React 重渲染） |
| `src/dashboard/public/index.html:183` | 每个 `log` 事件触发一次 `appendLog` + `renderLogs` |

如果 10 个 Agent 同时输出日志，每秒可能触发 50+ 次 SSE 事件，每次触发 React 状态更新。低性能设备上会导致 UI 卡死。

**改进建议**：
- 前端用 `requestAnimationFrame` 合并渲染（批量更新）
- 或使用 100ms 的 debounce 窗口
- React 端使用 `useTransition` / `startTransition` 标记低优先级更新

---

## 5. 数据与状态管理缺陷

### 5.1 🔴 `workflowStatus` 缺少 `'failed'` 状态

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:24` | `useState<'idle' | 'running' | 'completed'>` — 缺少 `'failed'` |

**工控视角分析**：
工作流执行失败（LLM API 错误、Agent 崩溃等）时，前端状态仍为 `'running'` → Launch 按钮保持 disabled → 操作员以为系统仍在运行，但实际上已经挂了。这是**状态机设计的基础缺陷**。

**改进建议**：
- 增加 `'failed'` 状态，由 SSE `error` 事件触发
- `failed` 状态下显示红色错误横幅 + 错误描述 + 重试按钮
- `failed` 状态自动解除 Launch 按钮的 disabled

---

### 5.2 🔴 无数据校验/类型安全 — `any` 类型泛滥

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:67` | `JSON.parse(e.data)` 无类型守卫 |
| `src/dashboard/public/index.html:174` | 同样无校验 |
| `src/server/index.ts:44` | `pendingApprovals` 使用 `any[]` |

**工控视角分析**：
SSE 事件数据格式未经验证，如果后端因 bug 发送了格式错误的数据，前端可能直接崩溃（白屏）或进入不可预期的状态。

**改进建议**：
- 定义 SSE 事件的 TypeScript 接口，使用 `zod` 或类型守卫验证
- `JSON.parse` 包裹在 try-catch 中，解析失败时记录日志并使用默认值
- 禁止 `any` 类型，启用 `strict: true` tsconfig

---

### 5.3 🟠 审批请求使用内存 Map — 进程重启丢失

| 位置 | 问题 |
|------|------|
| `src/server/index.ts:42` | `const pendingApprovals = new Map()` — 纯内存 |

如果服务进程在审批等待期间崩溃/重启，所有待审批请求丢失，相关的 SubAgent Promise 永不 resolve。

**改进建议**：
- 审批状态持久化到文件或 SQLite
- 进程重启时恢复待审批列表

---

### 5.4 🟠 配置 API 无输入验证

| 位置 | 问题 |
|------|------|
| `src/server/index.ts:80-87` | `POST /api/config` 直接写入 `GlobalConfig.update()` |
| `ui/src/App.tsx:40-46` | 相同 |

`requireApproval` 字段可以传入任意值（`"true"` 字符串、`null`、对象），没有类型检查和范围验证。

---

### 5.5 🟡 `API_BASE` 硬编码

| 位置 | 问题 |
|------|------|
| `ui/src/App.tsx:17` | `const API_BASE = 'http://localhost:3000/api'` |

部署到工控机时（端口可能冲突、IP 可能非 localhost），需要手动修改源码并重新编译。

**改进建议**：
- 使用环境变量 `VITE_API_BASE`
- 或相对路径 `/api` + 反向代理

---

## 6. 安全性与会话审计缺陷

### 6.1 🔴 审批接口无身份认证

| 位置 | 问题 |
|------|------|
| `src/server/index.ts:97-110` | `POST /api/approve` 无任何鉴权 |
| `src/dashboard/server.ts:40-48` | `/api/approve` 同上 |

**工控视角分析**：
工控系统中，审批操作（批准执行 Shell 命令、写入文件）具有极高权限。无认证意味着**任何能访问局域网的人**都可以批准/拒绝审批。这在生产网络中是严重的安全漏洞。

**改进建议**：
- 至少实现简单的 Token/密码认证（Bearer Token）
- 或基于 IP 白名单限制访问
- 长期应集成 LDAP/AD 认证

---

### 6.2 🔴 无操作审计日志

| 位置 | 问题 |
|------|------|
| 全局 | 无任何"谁在何时做了什么"的记录 |

**工控视角分析**：
FDA 21 CFR Part 11、IEC 62443 等工控法规要求所有关键操作必须可追溯。当前系统无法回答：
- 谁批准了那个危险 Shell 命令？
- 谁修改了审批配置？
- 谁启动了工作流？

**改进建议**：
- 所有关键操作（审批、配置修改、工作流启停）记录审计日志
- 审计日志包含：时间戳、操作类型、操作者（IP/Token）、操作内容、结果
- 审计日志写入 `.workflow/audit.jsonl`，不可删除

---

### 6.3 🔴 `/workspace` 静态托管暴露整个项目目录

| 位置 | 问题 |
|------|------|
| `src/dashboard/server.ts:22` | `app.use('/workspace', express.static(process.cwd()))` |

**工控视角分析**：
`express.static` 将**整个工作目录**暴露为静态资源。任何人通过 `http://<ip>:3000/workspace/.env` 可以读取环境变量文件、`.workflow/config.json` 中的 API Key、源代码等敏感信息。

**改进建议**：
- `express.static` 限制为特定子目录（如 `./output`、`./public`）
- 添加黑名单（禁止 `.env`、`.git`、`.workflow` 等）
- 添加认证中间件

---

### 6.4 🟠 无速率限制 — API 易被滥用

| 位置 | 问题 |
|------|------|
| `src/server/index.ts:92-96` | `POST /api/workflow` 无速率限制 |
| `src/dashboard/server.ts:40` | `POST /api/approve` 无速率限制 |

恶意或误操作可能在短时间内发起大量工作流请求，消耗 LLM API 额度。

**改进建议**：
- 使用 `express-rate-limit` 限制 API 调用频率
- `/api/workflow` 限制为 10次/分钟
- `/api/approve` 限制为 30次/分钟

---

## 7. 综合改进路线图

### P0 — 立即修复（1-2 周）

| # | 缺陷 | 影响 |
|---|------|------|
| 1 | Error Boundary 缺失 → 白屏 (2.2) | 系统可用性 |
| 2 | 工作流无 E-Stop (1.3) | 操作安全 |
| 3 | SSE 无重连/心跳 (1.1) | 数据时效性 |
| 4 | `workflowStatus` 缺 `failed` 状态 (5.1) | 状态准确性 |
| 5 | Toast 通知系统 (3.1) | 用户感知 |
| 6 | `/workspace` 目录暴露 (6.3) | 信息安全 |
| 7 | 审批接口无认证 (6.1) | 操作安全 |
| 8 | 审批 Modal 仅显示第一个请求 (2.8) | 功能完整性 |

### P1 — 尽快修复（2-4 周）

| # | 缺陷 | 影响 |
|---|------|------|
| 9 | 报警管理系统 (2.1) | 运维效率 |
| 10 | 触摸目标尺寸达标 (2.5) | 操作可用性 |
| 11 | 键盘焦点样式 (2.6) | 无障碍 |
| 12 | 关键操作二次确认 (2.3) | 误触防护 |
| 13 | 亮色主题支持 (2.4) | 强光可读性 |
| 14 | 日志级别分类 (3.2) | 告警准确性 |
| 15 | 审批超时处理 (3.4) | 流程完整性 |
| 16 | 日志虚拟滚动 (4.1) | 渲染性能 |
| 17 | 操作审计日志 (6.2) | 合规性 |

### P2 — 计划改进（1-3 个月）

| # | 缺陷 | 影响 |
|---|------|------|
| 18 | Python Windows 兼容 (1.4) | 平台覆盖 |
| 19 | 服务进程守护化 (1.2) | 可靠性 |
| 20 | 响应式布局 (4.4) | 多分辨率 |
| 21 | 数据可视化组件 (2.12) | 态势感知 |
| 22 | UI/Dashboard 统一 (2.7) | 一致性 |
| 23 | SSE 事件序列号 (3.7) | 消息可靠性 |
| 24 | 告警聚合与抑制 (3.6) | 告警风暴 |
| 25 | 离线降级模式 (1.7) | 离线可用性 |
| 26 | 状态持久化恢复 (3.5) | 断电恢复 |
| 27 | 速率限制 (6.4) | API 安全 |
| 28 | API_BASE 环境变量化 (5.5) | 部署灵活性 |

---

## 8. 总结

从工控机工程师的视角审视，当前系统在**核心算法和 LLM 编排**方面设计出色（并发控制、Token 预算、拓扑分解等），但在**工控 HMI 标准合规性**方面存在系统性缺陷。主要体现在：

1. **"开发者工具"思维 vs "工业产品"思维**：当前 UI 设计更像是开发阶段的调试面板，而非面向产线操作员的生产工具。`console.error` 作为唯一的错误处理方式在工控场景下完全不可见。

2. **可靠性工程缺失**：无重连、无心跳、无守护进程、无 E-Stop —— 这些在 Web 开发中"锦上添花"的特性，在工控场景下是**基线要求**。

3. **安全与合规零覆盖**：无认证、无审计、目录暴露 —— 在受到 IEC 62443 / FDA 21 CFR Part 11 监管的环境中，这些是部署的硬阻断项。

4. **人因工程未考虑**：触摸目标、键盘导航、声音报警、暗色/亮色主题 —— 这些直接影响操作员的效率和错误率。

**最低可部署（Minimum Deployable）条件**：
在将系统部署到任何生产工控环境之前，P0 级别的 8 个缺陷**必须全部解决**。P1 级别的缺陷至少需要解决 60%（报警管理、触摸目标、二次确认、日志虚拟滚动）。

---

> 📌 **报告签署**  
> 审查工程师：高级资深工控机工程师（模拟角色）  
> 审查日期：2025-07-18  
> 下次审查：P0 修复完成后
