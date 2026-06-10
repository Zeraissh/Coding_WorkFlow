# 工控人机界面（HMI）设计缺陷清单

> 审查范围：React SPA (`ui/src/`) + Dashboard (`src/dashboard/`)  
> 审查标准：工业控制 HMI 标准（布局合理性、交互直观性、错误提示、触摸/键盘兼容性、信息密度）

---

## 一、布局与信息架构缺陷

### 1.1 固定宽度设计，不兼容工业显示器
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | `.app-container` | `max-width: 1200px; height: 100vh` 固定尺寸，工业常见分辨率 1024×768、1280×800、1920×1080 下要么留白过多要么溢出 | 高 |
| `src/dashboard/public/index.html` | `.container` | 三列固定栅格 `350px 1fr 400px`，在窄屏 (< 1280px) 下会产生水平滚动条 | 高 |
| `ui/src/App.tsx` | `main-layout` div | 使用硬编码 `style={{ flex: '0 0 300px' }}` 固定侧边栏宽度，无响应式断点 | 中 |

### 1.2 缺少全局状态摘要区域
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 整体布局 | 无 "一览式" 仪表盘：没有系统健康状态、任务进度百分比、告警计数等 HMI 必需的 at-a-glance 指标 | 高 |
| `src/dashboard/public/index.html` | `layout-top` | 仅有 Token 和 Retention Score 两个指标，缺乏系统状态指示灯（运行/空闲/故障） | 高 |

### 1.3 信息层级混乱
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 第 115–174 行 | 侧边栏（Plugins + Memory）与主内容区（Kanban）权重相等，实际工作中侧边栏应为辅助信息 | 中 |
| `ui/src/index.css` | `.kanban` | `grid-template-columns: repeat(auto-fit, minmax(300px, 1fr))` 在大屏上卡片过宽，单行信息阅读困难 | 中 |

### 1.4 缺乏专用报警/事件区域
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 全局 | 无独立报警栏或事件摘要区。HMI 标准要求报警按优先级排列并始终可见 | 高 |
| `src/dashboard/public/index.html` | 全局 | 日志面板混用普通日志和错误日志，无报警分类、确认机制 | 高 |

---

## 二、交互直观性缺陷

### 2.1 关键操作缺乏确认机制
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | `handleApprove`（第 103 行） | "Reject" 操作无二次确认对话框，工控场景下误触后果严重 | 高 |
| `ui/src/App.tsx` | `startWorkflow`（第 49 行） | 启动工作流无确认步骤，Enter 键直接触发，易误操作 | 中 |
| `src/dashboard/public/index.html` | `submitReview`（第 298 行） | 审核拒绝按钮同样无二次确认 | 高 |

### 2.2 操作反馈不明确
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 第 39 行 | API 调用 `.catch(console.error)` — 失败时无任何用户可见提示 | 高 |
| `ui/src/App.tsx` | 第 117 行 | 输入框 placeholder "What would you like the agents to build today?" 未标明 Enter 键可提交 | 中 |
| `ui/src/index.css` | `.toggle` | 开关按钮无 `aria-label`，屏幕阅读器无法识别状态 | 中 |
| `src/dashboard/public/index.html` | 第 220 行 `toggleTask` | 任务卡片可点击展开，但无视觉提示（如箭头图标），用户不知道可交互 | 高 |

### 2.3 交互模式不一致
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | `handleApprove` vs `toggleApproval` | 审批请求通过 API 发送并等待，但开关切换直接 fire-and-forget — 不一致的异步处理模式 | 中 |
| `src/dashboard/public/index.html` | `toggleTask` | 展开任务时自动切换日志过滤器，这个隐式行为未告知用户，可能困惑 | 中 |

### 2.4 缺乏撤销/回退能力
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 全局 | 审批一旦执行（Approve/Reject）无法撤销 | 高 |
| `src/dashboard/public/index.html` | `submitReview` | 同上，工控标准要求关键操作可撤销 | 高 |

---

## 三、错误提示与通知机制缺陷

### 3.1 无 Toast/通知系统
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 第 30、39 行 | 所有 fetch 错误仅 `console.error`，用户完全不知情 | **严重** |
| `ui/src/App.tsx` | 第 68 行 SSE | EventSource 连接失败无任何处理（无 `onerror` 回调） | **严重** |
| `src/dashboard/public/index.html` | 第 174 行 | `new EventSource('/events')` 无重连逻辑，网络断开后静默失效 | **严重** |

### 3.2 错误分类粗糙
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `src/dashboard/public/index.html` | 第 392 行 | 仅通过字符串匹配 `'error'`/`'fail'` 判断日志级别，极易遗漏真实错误 | 高 |
| `ui/src/index.css` | 全局 | 仅有 `--error: #ef4444` 一种错误色，无 Warning/Critical/Info 等多级语义色 | 中 |

### 3.3 无错误边界与优雅降级
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 根组件 | 无 React Error Boundary，任何子组件崩溃导致整个界面白屏 | **严重** |
| `ui/src/App.tsx` | `workflowStatus` 状态机 | 仅有 `'idle' | 'running' | 'completed'` 三种状态，缺少 `'failed'` 状态。工作流失败后 UI 仍显示 "running" | **严重** |

### 3.4 审批模态框缺陷
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 第 178–196 行 | `approvals` 数组始终只渲染 `approvals[0]`，多个并发审批请求时其余被忽略 | 高 |
| `src/dashboard/public/index.html` | 第 91–170 行 | 审核弹窗使用 `display: none/active` 切换，无 `aria-modal`、无焦点陷阱 | 中 |

---

## 四、触摸/键盘兼容性缺陷

### 4.1 触摸目标过小（HMI 标准要求 ≥ 44×44px）
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | `.toggle` | 开关尺寸 40×24px，远小于工控触摸标准（戴手套操作需 ≥ 48px） | 高 |
| `ui/src/index.css` | `.task-status` | 状态标签 `padding: 0.25rem 0.75rem`，实际触击区域过小 | 中 |
| `src/dashboard/public/index.html` | `.file-pill` | `padding: 2px 6px; font-size: 0.75rem` 触击目标极小 | 高 |
| `src/dashboard/public/index.html` | `.log-controls button` | `padding: 4px 8px; font-size: 0.8rem` 过滤按钮过小 | 高 |

### 4.2 缺乏触摸优化
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | 全局 | 无 `@media (pointer: coarse)` 查询为触摸设备增大交互区域 | 高 |
| `ui/src/index.css` | `.kanban`、`.task-logs` | 嵌套滚动容器在触摸设备上滚动体验差，无 `-webkit-overflow-scrolling: touch` | 中 |
| `ui/src/index.css` | `.chat-input button:active` | 仅有 `:active` 伪类反馈，无触摸涟漪效果，用户无法确认触击成功 | 中 |

### 4.3 键盘导航缺失
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 全局 | 无可切换的 Tab 顺序管理，审批弹窗无焦点锁定 | 高 |
| `ui/src/index.css` | 全局 | 无 `:focus-visible` 样式（仅在 App.css 的 `.counter` 中存在），键盘用户无法判断当前焦点位置 | 高 |
| `src/dashboard/public/index.html` | 全局 | 无任何 `:focus` 或 `:focus-visible` 样式，Tab 键导航完全无视觉反馈 | **严重** |
| `ui/src/App.tsx` | 审批按钮 | 无键盘快捷键（如 Enter=Approve, Esc=Reject），工控常用物理键盘操作 | 中 |

### 4.4 滚动与滑动手势
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | `.kanban` | `overflow-y: auto` 与 `.app-container` 的 `height: 100vh` 嵌套滚动冲突 | 中 |
| `src/dashboard/public/index.html` | `.panel` | `max-height: 85vh; overflow: hidden` + 内部 `.task-list` / `.log-box` 各自滚动，三层嵌套滚动体验极差 | 高 |

---

## 五、信息密度与可读性缺陷

### 5.1 字体过小，不适于工业远距离观看
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | `.task-logs` | `font-size: 0.85rem` — 工控屏通常 ≥ 1rem 才能保证 1m 距离可读 | 中 |
| `ui/src/index.css` | `.task-status` | `font-size: 0.8rem` — 状态标识字体过小 | 中 |
| `src/dashboard/public/index.html` | `.log-box` | `font-size: 0.85rem` + monospace，可读性进一步降低 | 中 |
| `src/dashboard/public/index.html` | `.change-item` | `font-size: 0.8rem`，文件变更信息难以快速辨识 | 中 |

### 5.2 缺乏数据可视化
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 整体 | 全部信息以文本/列表呈现，无趋势图、进度条、仪表盘等 HMI 标准可视化组件 | 高 |
| `src/dashboard/public/index.html` | Token Ticker | Token 消耗仅显示数字，无历史趋势或预算剩余百分比 | 中 |

### 5.3 无颜色语义标准
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | `:root` | 仅定义 `--success` 和 `--error` 两种语义色，缺少 Warning (黄)、Info (蓝)、Critical (红闪) 等工控标准色 | 中 |
| `src/dashboard/public/index.html` | 第 17 行 | 定义了 `--warn` 但未定义 `--info`、`--critical`，日志颜色分类不完整 | 中 |

### 5.4 暗色主题在工业环境的问题
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | `:root` | 暗色主题 (`--bg-color: #0f172a`) 在强光车间环境下对比度不足，无亮色模式切换 | 高 |
| `ui/src/index.css` | `.header h1` | 渐变色标题 `linear-gradient(90deg, #60a5fa, #c084fc)` 在某些 LCD 面板上可能模糊不清 | 中 |

### 5.5 日志信息过载无过滤
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | `task-logs` | 日志仅简单罗列，无按级别/时间/关键词过滤，`max-height: 200px` 限制后信息丢失 | 高 |
| `src/dashboard/public/index.html` | `logFilter` | 仅能按 Task ID 过滤，不能按严重级别（Error/Warn/Info）过滤 | 高 |

---

## 六、工控 HMI 特有缺陷

### 6.1 无报警管理系统
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| 所有 UI 文件 | — | 工业 HMI 强制要求：分级报警列表、报警确认按钮、报警声音、报警历史记录 — **完全缺失** | **严重** |

### 6.2 无用户认证与操作审计
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `src/dashboard/server.ts` | `/api/approve` | 审批接口无身份验证，任何人均可操作 | **严重** |
| `ui/src/App.tsx` | 全局 | 无法追溯 "谁在何时批准/拒绝了什么" | 高 |

### 6.3 无系统心跳/看门狗指示
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| 所有 UI 文件 | — | HMI 标准要求持续显示系统连接状态（心跳指示灯），当前 SSE 断开后用户无从得知 | **严重** |

### 6.4 无紧急停止/手动超控
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 全局 | 工作流运行中无 "紧急停止" 或 "暂停" 按钮，只能等待完成或刷新页面 | **严重** |

### 6.5 状态持久化缺失
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 所有 `useState` | 页面刷新后所有状态丢失（审批队列、任务进度、日志），HMI 要求断电恢复能力 | 高 |
| `src/dashboard/public/index.html` | `tasks Map` | 同样，刷新后所有执行历史消失 | 高 |

---

## 七、渲染性能与动画缺陷

### 7.1 动画可能导致工控屏闪烁
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | `slideUp`、`scaleUp`、`fadeIn` | CSS 动画在低性能工控一体机上可能导致闪烁或掉帧 | 中 |
| `ui/src/index.css` | `.toggle::after` | `transition: all 0.3s cubic-bezier(...)` 使用 `all` 过渡可能触发意外属性动画 | 低 |

### 7.2 日志渲染未做虚拟化
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | `task.logs.map(...)` | 日志直接全量渲染，日志 > 1000 条时性能急剧下降 | 高 |
| `src/dashboard/public/index.html` | `renderLogs()` | 每次新日志到来重新 `innerHTML` 全部日志，同问题 | 高 |

---

## 八、代码质量与可维护性

### 8.1 内联样式泛滥
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/App.tsx` | 第 113–197 行 | 大量硬编码 `style={{...}}` 内联样式，无法复用、难以统一调整（例如统一放大字体适应工控屏） | 高 |
| `src/dashboard/public/index.html` | 多处 | 混用 `<style>` 块和内联 `style="..."`，维护困难 | 中 |

### 8.2 魔法数字与硬编码
| 文件 | 位置 | 问题描述 | 严重度 |
|------|------|----------|--------|
| `ui/src/index.css` | 全局 | CSS 变量定义不完整，大量硬编码色值（如 `#60a5fa`、`#c084fc`）分散在样式和 JSX 中 | 中 |
| `ui/src/App.tsx` | `API_BASE` | `'http://localhost:3000'` 硬编码，部署到工控机时需手动修改 | 中 |

---

## 总结

| 类别 | 缺陷数量 | 严重缺陷 | 高 | 中 | 低 |
|------|----------|----------|-----|-----|-----|
| 布局与信息架构 | 4 | 0 | 3 | 1 | 0 |
| 交互直观性 | 5 | 0 | 3 | 2 | 0 |
| 错误提示与通知 | 5 | 4 | 1 | 0 | 0 |
| 触摸/键盘兼容性 | 5 | 1 | 3 | 1 | 0 |
| 信息密度与可读性 | 5 | 0 | 3 | 2 | 0 |
| 工控 HMI 特有 | 5 | 4 | 1 | 0 | 0 |
| 渲染性能 | 2 | 0 | 1 | 1 | 0 |
| 代码质量 | 2 | 0 | 1 | 1 | 0 |
| **合计** | **33** | **9** | **16** | **8** | **0** |

**优先级建议：**
1. **立即修复（P0）**：添加错误通知系统、EventSource 重连、Error Boundary、工作流失败状态、紧急停止按钮、系统心跳指示
2. **尽快修复（P1）**：触摸目标尺寸、键盘焦点样式、审批二次确认、报警分级、亮色主题支持
3. **计划改进（P2）**：响应式布局、数据可视化、日志虚拟化、内联样式迁移到 CSS Module
