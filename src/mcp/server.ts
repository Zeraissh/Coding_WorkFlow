/**
 * MCP Server 模式（P3）— 把工作流引擎本身暴露为 MCP server。
 *
 * Claude Code / Cursor / 任何 MCP 客户端都可以把本引擎当作一个工具调用：
 *   - run_workflow：执行完整多 Agent 工作流（分解→并行执行→验证→合成）
 *   - query_knowledge：查询项目知识库（需求规格/架构决策/调研结论）
 *   - list_skills：列出 skill 注册表及胜率
 *   - get_eval_summary：最近的工作流质量统计
 *
 * 启动：`autocode mcp-serve`（stdio 传输）。
 * 注意：stdio 模式下引擎的 console.log 会污染 JSON-RPC 流，
 * CLI 入口在启动前会把 console.log 重定向到 stderr。
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { Orchestrator } from '../core/orchestrator';
import { KnowledgeStore } from '../core/knowledge';
import { SkillRegistry } from '../core/skills';
import { Evaluator } from '../core/evaluator';

export function createMcpServer(cwd: string = process.cwd()): McpServer {
  const server = new McpServer({
    name: 'coding-workflow',
    version: '1.0.1',
  });

  server.registerTool(
    'run_workflow',
    {
      description:
        'Run a full multi-agent coding workflow: the goal is decomposed into a task DAG, ' +
        'executed by parallel sub-agents with file locking and token budgeting, then verified ' +
        'and synthesized. Long-running (minutes). Requires an LLM API key configured via ' +
        '`autocode config` or environment variables.',
      inputSchema: {
        goal: z.string().describe('The development goal to achieve'),
        resume: z.boolean().optional().describe('Resume a previously interrupted workflow'),
      },
    },
    async ({ goal, resume }) => {
      const orchestrator = new Orchestrator();
      const result = await orchestrator.executeWorkflow(goal, resume ? { resume: true } : undefined);
      return { content: [{ type: 'text', text: result }] };
    }
  );

  server.registerTool(
    'query_knowledge',
    {
      description:
        'Query the project knowledge base (requirements specs, architecture decisions, ' +
        'research findings recorded by past workflows).',
      inputSchema: {
        query: z.string().describe('What you want to know'),
        topK: z.number().optional().describe('Number of results, default 3'),
      },
    },
    async ({ query, topK }) => {
      const hits = new KnowledgeStore(cwd).search(query, topK ?? 3);
      const text = hits.length === 0
        ? 'No matching knowledge found.'
        : hits.map(h => `### ${h.docTitle} (score ${h.score.toFixed(2)})\n${h.chunk}`).join('\n\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'list_skills',
    {
      description: 'List the skill registry: domain context packs with usage counts and win rates.',
      inputSchema: {},
    },
    async () => {
      const skills = new SkillRegistry(cwd).listSkills();
      const text = skills.length === 0
        ? 'No skills registered yet.'
        : skills.map(s => {
            const winRate = s.uses > 0 ? `${Math.round((s.wins / s.uses) * 100)}%` : 'n/a';
            return `- [${s.status}] ${s.name} (uses: ${s.uses}, win rate: ${winRate}) — ${s.description}`;
          }).join('\n');
      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'get_eval_summary',
    {
      description: 'Get quality statistics from recent workflow runs (success rates, verification results, token usage).',
      inputSchema: {},
    },
    async () => {
      const evaluator = new Evaluator(cwd);
      try {
        const { records, retentionScore } = evaluator.getLogs();
        const recent = records.slice(-10);
        const lines = [
          `Quality score: ${retentionScore}/100 (success rate 70% + verification pass 30%)`,
          `Total recorded workflows: ${records.length}`,
          '',
          'Recent runs:',
          ...recent.map(r =>
            `- ${new Date(r.timestamp).toISOString()} | tasks ${r.successfulTasks}/${r.totalTasks}` +
            ` | tokens ${r.totalTokens.toLocaleString()} | ${r.stopped ? 'E-STOPPED' : 'completed'}` +
            (r.skillId ? ` | skill ${r.skillId}` : '')
          ),
        ];
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } finally {
        evaluator.dispose();
      }
    }
  );

  return server;
}
