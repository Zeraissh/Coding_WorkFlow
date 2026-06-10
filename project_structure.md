# Coding_WorkFlow — 项目文件结构清单

> 生成日期: 2025-07-18  
> 项目根目录: `D:\Work\Github_pros\Coding_WorkFlow`

---

## 一、项目概览

| 属性 | 值 |
|---|---|
| **项目名称** | `coding_workflow` |
| **版本** | `1.0.0` |
| **语言** | TypeScript (主) + Python (辅助) |
| **模块系统** | ESM (`"type": "module"`) |
| **运行时** | Node.js (TS 编译为 JS) |
| **包管理器** | npm |
| **构建工具** | TypeScript Compiler (`tsc`) |
| **测试框架** | Vitest (TS 端) + Pytest (Python 端) |
| **前端 UI** | React + Vite (位于 `ui/`) |
| **入口 CLI** | `./bin/autocode.cjs` |

---

## 二、完整目录树

```
Coding_WorkFlow/
├── .git/                              # Git 版本控制 (隐藏)
├── __pycache__/                       # Python 字节码缓存
│   ├── cli.cpython-313.pyc
│   ├── data_forwarder.cpython-313.pyc
│   ├── serial_bridge.cpython-313.pyc
│   ├── virtual_serial.cpython-313.pyc
│   └── virtual_serial_core.cpython-313.pyc
│
├── bin/
│   └── autocode.cjs                   # ★ CLI 入口 (package.json bin)
│
├── src/                               # ★ 核心源码 (TypeScript)
│   ├── index.ts                       # 主入口 / 导出聚合
│   ├── test_llm.ts                    # LLM 测试工具
│   │
│   ├── cli/
│   │   ├── config.ts                  # CLI 配置加载
│   │   └── interactive.ts             # 交互式命令行界面
│   │
│   ├── core/                          # ★ 核心引擎
│   │   ├── agent.ts                   # AI Agent 主体 (思考/行动循环)
│   │   ├── config.ts                  # 核心配置管理
│   │   ├── evaluator.ts               # 结果评估器
│   │   ├── events.ts                  # 事件系统
│   │   ├── fslock.ts                  # 文件系统锁 (并发控制)
│   │   ├── indexer.ts                 # 代码索引器
│   │   ├── memory.ts                  # Agent 记忆模块
│   │   ├── orchestrator.ts            # 子任务编排器 (入口)
│   │   ├── retriever.ts               # 知识/上下文检索器
│   │   ├── snapshotManager.ts         # 快照管理 (版本回退)
│   │   ├── stateManager.ts            # 状态机管理
│   │   ├── tokenBudget.ts             # Token 预算控制
│   │   │
│   │   ├── orchestrator/              # 编排子模块
│   │   │   ├── decomposer.ts          # 任务分解器
│   │   │   ├── templates.ts           # 提示词模板
│   │   │   └── types.ts               # 编排类型定义
│   │   │
│   │   └── verifier/                  # 验证子模块
│   │       ├── autoChecker.ts         # 自动语法/测试检查
│   │       ├── semanticReviewer.ts    # 语义审查
│   │       └── types.ts               # 验证类型定义
│   │
│   ├── dashboard/                     # Web 仪表盘
│   │   ├── server.ts                  # Express 仪表盘服务器
│   │   └── public/
│   │       └── index.html             # 仪表盘前端页面
│   │
│   ├── llm/
│   │   └── client.ts                  # LLM 客户端封装 (Anthropic/OpenAI)
│   │
│   ├── mcp/
│   │   ├── client.ts                  # MCP 协议客户端
│   │   └── registry.ts                # MCP 工具注册表
│   │
│   ├── server/
│   │   └── index.ts                   # 后端 API 服务器
│   │
│   ├── tools/                         # 工具系统
│   │   ├── builtin.ts                 # 内建工具集
│   │   ├── git_tool.ts                # Git 操作工具
│   │   └── registry/
│   │       └── vector_store.ts        # 向量存储 (HNSWLib)
│   │
│   ├── types/
│   │   └── workflow.ts                # 工作流核心类型定义
│   │
│   └── utils/                         # 通用工具函数
│       ├── math.ts                    # 数学工具
│       └── stringReverse.ts           # 字符串反转示例
│
├── tests/                             # ★ 测试目录
│   ├── conftest.py                    # Pytest 配置/fixtures
│   ├── __init__.py                    # Python 包初始化
│   ├── __pycache__/                   # 测试字节码缓存
│   │   ├── conftest.cpython-313-pytest-9.0.3.pyc
│   │   ├── test_bridge.cpython-313-pytest-9.0.3.pyc
│   │   ├── test_config.cpython-313-pytest-9.0.3.pyc
│   │   ├── test_core.cpython-313-pytest-9.0.3.pyc
│   │   ├── test_integration.cpython-313-pytest-9.0.3.pyc
│   │   └── __init__.cpython-313.pyc
│   │
│   ├── test_bridge.py                 # 串口桥接测试
│   ├── test_config.py                 # 配置模块测试
│   ├── test_core.py                   # 核心功能测试
│   ├── test_integration.py            # 集成测试
│   ├── stringReverse.test.ts          # TS 端字符串反转测试
│   └── utils/
│       └── math.test.ts               # TS 端数学工具测试
│
├── ui/                                # ★ 前端界面 (React + Vite)
│   ├── index.html                     # Vite 入口 HTML
│   ├── package.json                   # UI 专属依赖
│   ├── package-lock.json
│   ├── vite.config.ts                 # Vite 构建配置
│   ├── tsconfig.json                  # UI TypeScript 配置
│   ├── tsconfig.app.json
│   ├── tsconfig.node.json
│   ├── eslint.config.js               # ESLint 配置
│   ├── README.md
│   ├── public/
│   │   ├── favicon.svg
│   │   └── icons.svg
│   └── src/
│       ├── main.tsx                   # React 入口
│       ├── App.tsx                    # 主应用组件
│       ├── App.css                    # 主样式
│       ├── index.css                  # 全局样式
│       └── assets/
│           ├── hero.png
│           ├── react.svg
│           └── vite.svg
│
├── 根目录配置与文档
│   ├── package.json                   # npm 项目配置 (★)
│   ├── package-lock.json
│   ├── tsconfig.json                  # TypeScript 编译配置 (★)
│   ├── README.md                      # 项目自述文件
│   ├── USAGE.md                       # 使用说明
│   └── Dynamic_Workflow_Plan.md       # 动态工作流设计文档
│
├── Python 辅助脚本 (根目录)
│   ├── cli.py                         # Python CLI 入口
│   ├── serial_bridge.py               # 串口通信桥接
│   ├── data_forwarder.py              # 数据转发器
│   ├── virtual_serial.py              # 虚拟串口主脚本
│   ├── virtual_serial_core.py         # 虚拟串口核心逻辑
│   ├── gen.py                         # 代码生成器
│   ├── _gen.py                        # 内部生成脚本
│   ├── _write_cli.py                  # CLI 写入工具
│   ├── _write_test.py                 # 测试写入工具
│   ├── test_serial.py                 # 串口测试脚本
│   ├── test_virtual_serial.py         # 虚拟串口测试
│   ├── test_virtual_serial_script.py  # 虚拟串口脚本测试
│   └── test_out.py                    # 输出测试
│
└── 临时/输出文件
    ├── t.txt, t2.txt, t3.txt, t5.txt,
    │   t6.txt, t7.txt, t10.txt,
    │   t12.txt, t13.txt                # 临时文本文件
    ├── $null                           # (空文件)
    ├── 2                               # (未知用途)
    └── npx                             # (Node 脚本)
```

---

## 三、模块职责说明

### 3.1 `src/core/` — 核心引擎

| 文件 | 职责 |
|---|---|
| `agent.ts` | AI Agent 主循环：接收任务 → 思考 → 调用工具 → 验证 → 输出 |
| `orchestrator.ts` + `orchestrator/` | 将复杂任务分解为子任务并编排执行顺序 |
| `verifier.ts` + `verifier/` | 对生成代码进行自动语法检查和语义审查 |
| `retriever.ts` | 从向量存储/文件系统中检索相关上下文 |
| `memory.ts` | Agent 短期/长期记忆管理 |
| `tokenBudget.ts` | 控制 LLM 调用的 token 消耗 |
| `stateManager.ts` | 工作流状态机 |
| `snapshotManager.ts` | 文件快照（支持回滚） |
| `evaluator.ts` | 评估生成结果的质量 |
| `indexer.ts` | 代码索引构建 |
| `events.ts` | 事件发布/订阅系统 |
| `fslock.ts` | 文件操作锁，防止并发冲突 |

### 3.2 `src/llm/` — LLM 抽象层

- 封装 Anthropic SDK 和 OpenAI SDK
- 提供统一的 `chat()` / `stream()` 接口

### 3.3 `src/mcp/` — Model Context Protocol

- 实现 MCP 客户端，连接外部工具服务器
- `registry.ts` 管理已注册的 MCP 工具

### 3.4 `src/tools/` — 工具系统

- `builtin.ts`: 读写文件、执行命令、搜索等基础工具
- `git_tool.ts`: Git 操作（commit, diff, log 等）
- `registry/vector_store.ts`: 基于 HNSWLib 的向量存储

### 3.5 `src/cli/` — 命令行界面

- `config.ts`: 加载 `.env` 和配置文件
- `interactive.ts`: 提供交互式 REPL 体验（使用 `@clack/prompts`）

### 3.6 `src/dashboard/` — Web 仪表盘

- Express 服务器 + 静态 HTML 页面
- 用于可视化监控 Agent 工作状态

### 3.7 `src/server/` — API 服务器

- 提供 REST API 供外部调用

### 3.8 `src/types/` — 类型定义

- `workflow.ts`: 定义 Workflow、Task、SubTask、Tool 等核心类型

### 3.9 `src/utils/` — 工具函数

- 通用的、与业务无关的帮助函数

---

## 四、技术栈总结

| 层次 | 技术 |
|---|---|
| **主语言** | TypeScript (ESM, ES2024+) |
| **辅助语言** | Python 3.13 |
| **AI SDK** | `@anthropic-ai/sdk`, `openai` |
| **协议** | MCP (`@modelcontextprotocol/sdk`) |
| **向量存储** | `hnswlib-node` + `@xenova/transformers` |
| **CLI 框架** | `commander` + `@clack/prompts` |
| **Web 框架** | `express` (v5) |
| **前端** | React 19 + Vite 6 |
| **测试** | Vitest (TS), Pytest (Python) |
| **编译** | TypeScript Compiler (`tsc`) |

---

## 五、入口与脚本

| 入口 | 说明 |
|---|---|
| `npm exec autocode` | 通过 npx 调用 `./bin/autocode.cjs` |
| `tsx src/index.ts` | 直接运行 TS 源码 |
| `python cli.py` | Python CLI 入口 |
| `python serial_bridge.py` | 串口桥接服务 |
| `python virtual_serial.py` | 虚拟串口调试工具 |
| `cd ui && npm run dev` | 启动前端开发服务器 |

---

## 六、构建产物说明

TypeScript 编译 (`tsc`) 会为每个 `.ts` 文件在同目录下生成：

- `.js` — 编译后的 JavaScript
- `.js.map` — Source Map
- `.d.ts` — 类型声明文件
- `.d.ts.map` — 声明文件的 Source Map

这些产物已在目录树中列出，此处不重复。

---

> **备注**: 根目录下存在一些临时文件 (`t*.txt`, `$null`, `2`, `npx`) 和 Python 缓存目录 (`__pycache__/`, `tests/__pycache__/`)，建议添加到 `.gitignore` 中。
