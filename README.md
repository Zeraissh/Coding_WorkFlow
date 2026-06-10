# 动态工作流 (Dynamic Workflow)

本项目受 Claude 的“动态工作流”架构启发，使用 Node.js 和 TypeScript 构建了一个基于大模型 (LLM) 的多 Agent 并发协作系统。它可以自动将复杂的用户需求拆解为独立子任务，并利用多 Agent 机制并行完成所有工作流。

## ✨ 核心能力

1. **Orchestrator（编排器）**：接收用户的复杂任务目标，自动按逻辑拆分为可独立执行的子任务。
2. **Parallel Sub-Agents（并行子代理）**：为每个子任务独立分配 Agent 并发执行。它内置了原生工具（读写文件、终端执行、网络搜索），使得 Agent 具备真实的操作系统和代码级行动能力。
3. **Verifier（验证与合成器）**：在所有 Agent 完成任务后，对全量执行结果进行逻辑校验和梳理，合并输出连贯的交付成果。
4. **Human-in-the-Loop (HITL)**：可选的安全拦截机制。对 AI 的系统终端调用指令进行拦截并询问审批，确保你的系统安全。

---

## 🚀 进阶更新特性（最新功能）

* **🌐 多模型与多服务商支持**：完全移除了仅支持 Anthropic 的限制。现在你可以自由切换使用：
  * **Anthropic** (如 `claude-3-5-sonnet-20241022`)
  * **OpenAI** (如 `gpt-4o`)
  * **DeepSeek** (支持最新的 `deepseek-v4-pro` 与 `deepseek-v4-flash`)
* **🧠 DeepSeek 深度思考全支持**：配置时可自定义推理强度（Reasoning Effort）。底层自带强大的 `<thinking>` 标签剥离和逻辑链展示能力，不会阻碍系统的任务解析。
* **⚙️ 交互式配置台 (`autocode config`)**：不再需要手动写 `.env` 文件。内建命令行交互面板供你在命令行内选择模型和输入 API Key。
* **💻 跨项目全局 CLI 支持**：支持 `npm link` 全局注册，随时随地在任何项目目录下输入 `autocode chat` 召唤工作流。

---

## 🏭 工业级并发与资源控制引擎

在多 Agent 并发操作的底层，系统搭载了四大核心机制保驾护航：

1. **🔒 基于微任务的文件锁 (`FSLock`)**：独创的 Promise 异步队列排队机制。彻底杜绝多个 Agent 并行写入同一文件导致的竞态覆写与代码损坏，并内置超时死锁熔断保护，支持安全的锁重入。
2. **💰 动态 Token 预算管家 (`Token Budget`)**：彻底告别 API 账单暴雷！Orchestrator 根据任务复杂度（权重）自动给每个 Agent 分配初始 Token 预算。带有 70%(提醒)/85%(截断)/95%(强制终止) 三级熔断预警。当有 Agent 提前完工时，其未消耗的 Token 盈余会**按剩余比例动态重分配**给其他存活的 Agent，将 API 资金利用率推向极致。
3. **🧠 智能拓扑分解 (`Smart Decomposer`)**：Orchestrator 不仅能拆解子任务，还能精准评估每个任务的 `estimatedComplexity`（估算复杂度），并自动分析子任务间的串并行逻辑依赖 (`dependencies`)。
4. **🕵️ 双轨制二阶验证 (`Two-phase Verifier`)**：所有 Agent 在工作时会自动打点留下精细的行动日志（`AgentExecutionLog`，涵盖修改了哪些代码、执行了哪些 Shell）。在收尾阶段，Verifier 将运用基于规则的 `AutoChecker`（验证测试、语法）与大模型驱动的 `SemanticReviewer`（验证业务语义）进行地毯式验收！

---

## 🛠 安装与配置

### 1. 克隆并安装依赖

```bash
git clone https://github.com/Zeraissh/Coding_WorkFlow.git
cd Coding_WorkFlow
npm install
```

### 2. 全局注册命令 (可选但极力推荐)

为了能在其他任意项目中直接使用，执行：

```bash
npm link
```
执行完毕后，你的电脑上将永久拥有一条全新的全局命令：`autocode`。

### 3. 配置模型参数

在任意终端运行：

```bash
autocode config
```
它会交互式地询问你的大模型偏好（OpenAI / Anthropic / DeepSeek），你要选用的具体模型名称，以及你的 API 秘钥。配置会安全地保存在你本机的 `~/.workflow_config.json` 中。

---

## 🎯 如何使用

配置完成后，在你想要修复 Bug、新建项目或者修改代码的任意文件夹中，运行：

```bash
autocode chat
```

然后输入你的需求（例如：`找出这个项目里导致串口断开的 Bug 并修复它` 或 `用Python写一个带计分板的贪吃蛇游戏，并且提供一份相应的单元测试`）。

> **内部运行过程：**
> 1. **拆解**：Orchestrator 结构化分解为：“编写贪吃蛇核心逻辑”、“编写计分板逻辑”、“编写测试用例” 等子任务。
> 2. **并行**：分配对应的子代理，在后台静默使用原生 `write_file` 和 `search_web` 工具，在当前目录下并行高速生成代码文件。
> 3. **合并**：所有的代码片段完成、终端测试运行完毕后，Verifier 审查结果并将完整操作日志打印输出。

---

## 📂 项目结构说明

- `bin/autocode.js`: 全局命令行入口包裹器
- `src/index.ts`: CLI 核心路由器（实现 `chat`、`config`、`run` 等指令）
- `src/core/config.ts`: 本地化配置文件管理与持久化
- `src/core/orchestrator.ts`: 任务规划拆解与全局调度器
- `src/core/fslock.ts`: 专为多并发设计的底层文件互斥锁
- `src/core/tokenBudget.ts`: 全局 Token 智能分配与熔断器
- `src/core/agent.ts`: 绑定了自动 Tool Injection 的子任务代理引擎
- `src/core/verifier.ts`: 综合校验并格式化最终答案的模块（内含 autoChecker / semanticReviewer）
- `src/llm/client.ts`: 适配了 OpenAI、Anthropic、DeepSeek 多态 SDK 与思维链解析的基础层
- `src/tools/builtin.ts`: 官方预装工具集（文件操作、Shell、Web）

---

## 💡 进阶开发

本项目不仅提供骨架，且自带 [MCP (Model Context Protocol)](https://github.com/modelcontextprotocol) 加载能力支持。如果你想引入数据库读取等高级工具，可通过配置向量数据库动态载入 MCP 插件 Server。欢迎拓展！
