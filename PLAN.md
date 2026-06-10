# 执行计划 (Execution Plan)

> 生成时间: 2025-07-18
> 基于项目: Coding_WorkFlow (动态工作流系统)
> 当前状态: 核心功能已实现，需进行验证、测试与优化

---

## 一、项目当前状态评估

### 已实现 ✅
1. **LLM 客户端抽象层** (`src/llm/client.ts`) — 支持 Anthropic, OpenAI, DeepSeek 多供应商
2. **Orchestrator 编排器** (`src/core/orchestrator.ts`) — 智能任务分解 + 拓扑分批并行执行
3. **Parallel Sub-Agents** (`src/core/agent.ts`) — 带工具调用循环的并发子代理
4. **Verifier 验证器** (`src/core/verifier.ts`) — 双轨制：AutoChecker + SemanticReviewer
5. **CLI 入口** (`src/index.ts`) — commander 驱动的命令行界面
6. **Token 预算管理** (`src/core/tokenBudget.ts`) — 三级熔断 + 动态重分配
7. **文件锁** (`src/core/fslock.ts`) — 并发写入冲突防护
8. **MCP 协议支持** (`src/mcp/`) — Model Context Protocol 集成
9. **Dashboard 仪表盘** (`src/dashboard/`) — Web 监控界面
10. **Git 集成** (`src/tools/git_tool.ts`) — 自动分支、提交、回滚
11. **快照管理** (`src/core/snapshotManager.ts`) — 支持回滚
12. **状态管理** (`src/core/stateManager.ts`) — 断点续跑
13. **前端 UI** (`ui/`) — React + Vite 界面
14. **Python 辅助脚本** — 虚拟串口、数据转发等

### TypeScript 编译状态
- `npx tsc --noEmit` → **零错误** ✅

---

## 二、待执行任务清单

### 阶段 1: 测试与验证 (优先级: 高)

| # | 任务 | 描述 | 预期产出 |
|---|------|------|----------|
| 1.1 | 运行现有测试套件 | 执行 `npx vitest run` 检查 TypeScript 端测试 | 测试结果报告 |
| 1.2 | 运行 Python 测试 | 执行 `pytest tests/` 检查 Python 端测试 | 测试结果报告 |
| 1.3 | 端到端集成测试 | 使用模拟 LLM 响应测试完整的 Orchestrator → Agent → Verifier 流程 | 集成测试通过 |
| 1.4 | CLI 冒烟测试 | 测试 `autocode chat`, `autocode config`, `autocode run` 命令 | CLI 可用性确认 |

### 阶段 2: Bug 修复与健壮性 (优先级: 高)

| # | 任务 | 描述 | 预期产出 |
|---|------|------|----------|
| 2.1 | 错误处理增强 | 审查所有 try/catch 块，确保错误信息清晰 | 改进的错误处理 |
| 2.2 | 配置缺失处理 | 当 API Key 未配置时提供友好提示和引导 | 更好的 UX |
| 2.3 | 空状态处理 | 处理无工具、无子任务、空项目等边界情况 | 边界情况覆盖 |
| 2.4 | JSON 解析容错 | LLM 返回非标准 JSON 时的容错与重试 | 解析健壮性 |

### 阶段 3: 性能优化 (优先级: 中)

| # | 任务 | 描述 | 预期产出 |
|---|------|------|----------|
| 3.1 | 并发控制优化 | 审查 `Promise.all` 的并发数限制 | 可控并发数 |
| 3.2 | Token 缓存利用 | 利用 Anthropic prompt caching 减少重复上下文成本 | 成本降低 |
| 3.3 | 文件扫描优化 | 大项目的 `safeListDir` 性能优化 | 更快的项目扫描 |

### 阶段 4: 文档与发布 (优先级: 中)

| # | 任务 | 描述 | 预期产出 |
|---|------|------|----------|
| 4.1 | API 文档 | 为核心模块生成 JSDoc/TSDoc 文档 | API 参考文档 |
| 4.2 | 用户指南更新 | 更新 README.md 和 USAGE.md | 完整的用户文档 |
| 4.3 | 示例项目 | 创建示例 workflows 供用户参考 | 示例文件 |
| 4.4 | npm 发布准备 | 检查 package.json, 版本号, 发布脚本 | 可发布的包 |

### 阶段 5: 高级功能 (优先级: 低)

| # | 任务 | 描述 | 预期产出 |
|---|------|------|----------|
| 5.1 | Web Dashboard 完善 | 完善 React 前端的状态展示和交互 | 完整的仪表盘 |
| 5.2 | 插件系统 | 支持第三方工具插件 | 插件接口 |
| 5.3 | 多轮对话记忆 | Agent 跨任务的长期记忆 | 记忆增强 |
| 5.4 | 工作流模板 | 预定义的工作流模板库 | 模板库 |

---

## 三、立即执行 (Next Actions)

### Action 1: 运行测试套件
```bash
cd D:\Work\Github_pros\Coding_WorkFlow
npx vitest run --reporter=verbose
```

### Action 2: 验证编译产物
```bash
npx tsc --noEmit
```

### Action 3: 测试 CLI 入口
```bash
node bin/autocode.cjs --help
```

### Action 4: 检查依赖版本
```bash
npm outdated
```

---

## 四、风险与缓解

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| LLM API 调用失败 | 工作流中断 | 重试逻辑 + 降级回退方案 |
| 并发文件冲突 | 代码损坏 | FSLock + SnapshotManager 回滚 |
| Token 成本失控 | 预算超支 | TokenBudget 三级熔断 |
| LLM 输出格式错误 | 解析失败 | JSON 修复 + fallback 逻辑 |

---

## 五、成功标准

1. ✅ TypeScript 编译零错误
2. ✅ 现有测试全部通过
3. ✅ 端到端流程可完成（输入目标 → 输出结果）
4. ✅ CLI 三个命令 (chat/config/run) 可正常启动
5. ✅ 多供应商 (Anthropic/OpenAI/DeepSeek) 可切换
