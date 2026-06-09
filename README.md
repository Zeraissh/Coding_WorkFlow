# 动态工作流 (Dynamic Workflow)

本项目受 Claude 新近推出的“动态工作流”架构启发，使用 Node.js 和 TypeScript 构建了一个基于大模型 (LLM) 的多 Agent 并发协作系统。

本系统包含以下核心能力：
1. **Orchestrator（编排器）**：接收用户的复杂任务目标，并自动将其拆解为多个逻辑独立的子任务。
2. **Parallel Sub-Agents（并行子代理）**：系统会为每个子任务并发拉起独立的 Agent 去执行，大幅提升执行效率，缩短等待时间。
3. **Verifier（验证与合成器）**：汇总所有子任务的结果，进行逻辑校验和梳理，最终合并输出一份完整、连贯的交付成果。

---

## ⚙️ 环境要求

- [Node.js](https://nodejs.org/) (建议版本 v18+)
- 有效的 Anthropic API 秘钥 (`ANTHROPIC_API_KEY`)

---

## 🚀 快速开始

### 1. 克隆并安装依赖

首先克隆本项目到本地，然后进入目录并安装必需的包：

```bash
git clone https://github.com/Zeraissh/Coding_WorkFlow.git
cd Coding_WorkFlow
npm install
```

### 2. 配置环境变量

在项目的根目录（即 `Coding_WorkFlow/`）下，新建一个名为 `.env` 的文件，将你的 API Key 填入其中：

```env
ANTHROPIC_API_KEY=sk-ant-api03...在这里填入你的实际秘钥...
```

### 3. 运行工作流

你可以直接使用 `tsx` 工具来执行命令行入口。通过 `run` 指令，并附带你想要让系统完成的复杂目标：

```bash
npx tsx src/index.ts run "用Python写一个带计分板的贪吃蛇游戏，并且提供一份相应的单元测试"
```

> **内部运行过程：**
> 1. **拆解**：编排器（Orchestrator）首先评估该任务，将其结构化分解为比如：“编写贪吃蛇核心逻辑”、“编写计分板逻辑”、“编写Pytest测试用例”这几个子任务。
> 2. **并行**：分配对应的三个子代理 (Sub-Agents) 在后台同时发起 LLM 请求。
> 3. **合并**：当所有的代码片段都编写完成后，验证器 (Verifier) 会检查是否存在疏漏，将其统一组装为最终内容并打印输出。

---

## 📂 项目结构说明

- `src/index.ts`: 命令行入口 (CLI)
- `src/core/orchestrator.ts`: 任务规划拆解与全局调度器
- `src/core/agent.ts`: 负责执行特定原子子任务的代理
- `src/core/verifier.ts`: 综合校验并格式化最终答案的模块
- `src/llm/client.ts`: 封装的 LLM 基础请求抽象层
- `src/types/workflow.ts`: 核心的数据结构和类型（Plan, SubTask, TaskResult）定义

---

## 🛠 进阶扩展

当前版本仅提供了一个坚实的代码骨架。如果你想让此工具变得更强大：
- **切换模型**：在 `src/llm/client.ts` 替换对应的 SDK，即可接入 OpenAI (GPT-4o) 或 Gemini 等其他大模型。
- **提供工具支持 (Tool Calling)**：在 `src/core/agent.ts` 的 API 调用中，绑定文件读写、网页搜索或执行终端命令等工具，即可让 Agent 具备真正的行动力。
