# SWE-bench-Lite 评测指南（WSL2）

整个流程分两段：**生成补丁**（本引擎跑题，花 API 钱）→ **官方评测**（Docker 跑测试出分，免费）。
以下全部命令在 **WSL2 的 Linux shell** 里执行（不是 PowerShell）。

## 0. 一次性环境准备（约 15 分钟）

```bash
# Node 22（WSL 内独立安装，不要复用 Windows 的 node）
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc && nvm install 22

# 本引擎（在 WSL 里 clone 一份并注册全局命令）
git clone https://github.com/Zeraissh/Coding_WorkFlow.git ~/coding-workflow
cd ~/coding-workflow && npm install && npm link
autocode --help   # 确认可用

# Python 依赖
pip install swebench datasets

# Docker：安装 Docker Desktop for Windows 并在设置里勾选
# Settings → Resources → WSL Integration → 你的发行版
docker run hello-world   # 确认可用
```

## 1. 配置引擎为无人值守模式（关键！）

编辑 WSL 里的 `~/.workflow_config.json`（注意：WSL 与 Windows 的 home 是两个文件）：

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-6",
  "apiKey": "<你的 API key>",
  "requireApproval": false,
  "clarifyConfig": { "auto": true },
  "budgetConfig": { "enabled": true, "totalTokens": 300000, "autoRebalance": true, "verifierReservePercent": 10,
                    "thresholds": { "warning": 0.70, "critical": 0.85, "exhaust": 0.95 } }
}
```

三个设置缺一不可：
- `requireApproval: false` —— 否则终端命令审批和最终 diff 审查会永久挂起
- `clarifyConfig.auto: true` —— 澄清阶段自动采用推荐项，不等人
- `budgetConfig` —— 单题 token 封顶 30 万，防止个别难题烧穿预算

## 2. 冒烟测试（1 题，约 5–15 分钟，<$1）

```bash
cd ~/coding-workflow/scripts/swebench
python3 run_predictions.py --limit 1
cat predictions.jsonl | python3 -m json.tool   # 确认 model_patch 非空
```

## 3. 跑子集（建议先 30 题，约 $5–15、3–8 小时）

```bash
python3 run_predictions.py --limit 30
```

支持随时 Ctrl+C：已完成的题记录在 `predictions.jsonl` 里，重跑会自动跳过（断点续跑）。
单题默认 30 分钟超时（`--timeout` 可调），超时也会收集已产出的部分补丁。

## 4. 官方评测出分（需要 Docker，30 题约 1–2 小时 + 30GB 磁盘）

```bash
python -m swebench.harness.run_evaluation \
  --dataset_name princeton-nlp/SWE-bench_Lite \
  --predictions_path predictions.jsonl \
  --max_workers 4 \
  --run_id coding-workflow-v1
```

输出的 `coding-workflow-v1.*.json` 报告里 `resolved_instances / total_instances` 就是分数。
参考线：早期 SWE-agent 在 Lite 上约 18%，当前开源 SOTA 50%+。第一次跑出可复现的数字最重要。

## 5. 全量 300 题（确认子集表现后再上，约 $50–150）

```bash
python3 run_predictions.py    # 不带 --limit
```

## 常见问题

| 现象 | 处理 |
|---|---|
| 卡在某题不动 | 看 http://localhost:3000 Dashboard；大概率是 requireApproval 没关 |
| `model_patch` 全空 | 检查 API key 是否有效（`autocode run "create hello.txt"` 单独验证） |
| Docker 评测报镜像构建失败 | 个别老仓库镜像源失效，属正常，harness 会标记 error 不影响其余题 |
| 想换模型对比 | 改 `~/.workflow_config.json` 的 model，用 `--model-name` 和不同 `--output` 区分两组结果 |
