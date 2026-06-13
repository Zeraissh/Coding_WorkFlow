# Coding Workflow (`autocode`)

[![CI](https://github.com/Zeraissh/Coding_WorkFlow/actions/workflows/ci.yml/badge.svg)](https://github.com/Zeraissh/Coding_WorkFlow/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/coding_workflow)](https://www.npmjs.com/package/coding_workflow)
[![SWE-bench Lite](https://img.shields.io/badge/SWE--bench_Lite-54.8%25_(30--case_subset)-brightgreen)](scripts/swebench/)

**[中文文档 / Chinese README](README.zh-CN.md)**

A **parallel multi-agent coding engine with resource governance and a self-improvement loop**. Give it a goal; it decomposes the goal into a task DAG, executes sub-agents concurrently under file locks and token budgets, verifies the result in two phases, and learns from every run.

Most coding agents (Aider, Cline) work sequentially. This engine's bet is different: **decompose → parallelize → govern → verify → evolve**.

## Benchmark

On a 30-instance subset of **SWE-bench Lite** (real GitHub issues from `astropy` and `django`), the engine resolved **17/31 = 54.8%** of submitted instances (63% of the 27 that produced a patch and ran to evaluation). For reference: early SWE-agent scored ~18% on Lite; current open-source SOTA is 50%+. This is a subset, so the number carries sampling noise — but it lands in the top tier. Reproduce it yourself with [`scripts/swebench/`](scripts/swebench/) (raw report: [`results-lite-30.json`](scripts/swebench/results-lite-30.json)).

## Why this engine

| Capability | What it does |
|---|---|
| 🔀 **Parallel sub-agents** | Goals decompose into a dependency DAG, topologically sorted into batches that run concurrently (bounded pool). `FSLock` write-mutexes prevent two agents from clobbering the same file. |
| 💰 **Token budget governance** | Budgets allocate per-task by complexity weight with 70/85/95% watermarks. When an agent finishes early, its surplus redistributes to live agents. No more bill surprises. |
| 🔍 **Clarify phase** | "Build a robot vacuum" is one sentence hiding firmware + host software + protocols. Complex ambiguous goals trigger research-grounded multiple-choice questions (options cite real products and GitHub projects), producing a requirements spec that becomes the planning contract. Simple goals skip this entirely. |
| 🎯 **Focus monitoring** | Out-of-scope writes, identical-call loops, and idle burn are detected per agent. Light drift gets a refocus warning fed back to the LLM; collapse suspends tool execution. A live focus score streams to the dashboard. |
| 📊 **Attributed evals** | Every run records per-task outcomes, verification results (lint/type/conflict/semantic counts), the active rules hash, prompt version, and matched skill — so "which change hurt quality" is a query, not a guess. |
| 📚 **Rules & skills that evolve** | Lessons deduplicate into domain-tagged rules (stale ones retire); repeated successes draft reusable skills (LLM-drafted, **human-activated** — nothing self-modifies silently); low-win-rate skills auto-retire. |
| 🛡 **Two-phase verification** | Rule-based `AutoChecker` (lint, types, tests, file conflicts) + LLM `SemanticReviewer`, then a synthesis pass merges everything into one coherent deliverable. |
| 🧰 **Production hygiene** | Diff-based `edit_file` tool, streaming output, E-Stop with resumable state, SSE heartbeat + reconnect, path-traversal jail + dangerous-command blacklist, atomic state writes, context compaction for long runs. |

## Quick start

```bash
git clone https://github.com/Zeraissh/Coding_WorkFlow.git
cd Coding_WorkFlow
npm install
npm link            # registers the global `autocode` command

autocode config     # pick provider (Anthropic / OpenAI / DeepSeek), model, API key
cd your-project
autocode chat       # interactive session + dashboard at http://localhost:3000
```

One-shot mode:

```bash
autocode run "Find and fix the bug that drops the serial connection"
autocode run "..." --resume    # continue an interrupted workflow
```

## The dashboard

`autocode chat`/`run` serves a live dashboard at `http://localhost:3000`:

- Task kanban with per-task logs, streamed model output, token spend, and focus score
- HITL approval modals for terminal commands and final diffs
- Clarify-phase questionnaires with research-grounded options
- Emergency **Stop** (state is saved; resume later), connection health indicator

## Self-improvement loop

```
Clarify (requirements spec) → Focused execution (scoped rules + skills)
        ↑                                        ↓
Regression gate (autocode eval) ← Rules dedup/retire + skill win rates ← Attributed evals
```

- `autocode eval --label baseline` runs your regression suite (`.workflow/eval_suite/cases.json`) and diffs against the previous run — exit code 1 on regressions, CI-ready. Run it before and after any prompt/rule/skill change.
- Skills live in `.workflow/skills/*.md` (frontmatter + prompt body) — hand-editable, keyword-matched, win-rate tracked.
- The knowledge base (`.workflow/knowledge/`) records requirements and decisions; agents query it with the `query_knowledge` tool before guessing.

## Use it from Claude Code / Cursor (MCP)

Expose the engine as an MCP server:

```bash
autocode mcp-serve
```

Tools exposed: `run_workflow`, `query_knowledge`, `list_skills`, `get_eval_summary`. Example Claude Code config:

```json
{
  "mcpServers": {
    "coding-workflow": { "command": "autocode", "args": ["mcp-serve"] }
  }
}
```

## Programmatic API

```ts
import { Orchestrator } from 'coding_workflow';

const orchestrator = new Orchestrator();
const result = await orchestrator.executeWorkflow('Create a CLI todo app with tests');
```

See `examples/basic-workflow.ts` and `examples/custom-tool.ts`.

## Project layout

```
src/core/orchestrator.ts   # planning, clarify phase, batch scheduling, lifecycle hooks
src/core/agent.ts          # sub-agent: tool loop, scoped rules, focus monitoring
src/core/orchestrator/     # decomposer (DAG), clarifier, zod schemas
src/core/verifier/         # AutoChecker + SemanticReviewer
src/core/fslock.ts         # write mutex with reentry, queues, conflict log
src/core/tokenBudget.ts    # weighted allocation, watermarks, rebalancing
src/core/rules.ts          # rule lifecycle (dedup, domains, retirement)
src/core/skills.ts         # skill registry (matching, win rates, drafting)
src/core/knowledge.ts      # knowledge base + lexical search
src/core/evaluator.ts      # attributed eval records
src/core/evalSuite.ts      # regression suite (autocode eval)
src/core/focus.ts          # drift detection + intervention ladder
src/core/repomap.ts        # file → symbols map for planning context
src/llm/client.ts          # Anthropic/OpenAI/DeepSeek, streaming, caching, compaction
src/mcp/                   # MCP client integration + MCP server mode
src/server/ + ui/          # SSE dashboard (React)
```

## Configuration

`autocode config` writes `~/.workflow_config.json`. Notable sections (all optional): `orchestratorConfig`, `agentConfig` (max tool calls, pool size), `clarifyConfig` (auto mode, complexity threshold), `focusConfig` (thresholds), `budgetConfig`, `fslockConfig`, `verifierConfig`.

API keys can also come from `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `DEEPSEEK_API_KEY` env vars (see `.env.example`).

## Development

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest (171 tests)
npm run build       # emits to dist/
```

CI runs the full matrix (Windows + Linux × Node 20/22) on every PR. See [CHANGELOG.md](CHANGELOG.md) for the release history.

## License

ISC
