import { askLLM } from '../llm/client';
import { Plan, TaskResult, SubTask, AgentExecutionLog } from '../types/workflow';
import { SubAgent } from './agent';
import { Verifier } from './verifier';
import { ToolRetriever } from './retriever';
import { workflowEvents } from './events';
import { Decomposer } from './orchestrator/decomposer';
import { tokenBudget } from './tokenBudget';
import { fslock } from './fslock';
import { GlobalConfig } from '../core/config';
import type { DecomposerConfig } from './orchestrator/types';
import { DEFAULT_DECOMPOSER_CONFIG } from './orchestrator/types';

export class Orchestrator {
  private decomposer: Decomposer;

  constructor() {
    const config = this.loadOrchestratorConfig();
    this.decomposer = new Decomposer(
      {
        callLLM: async (prompt, opts) => {
          const response = await askLLM(
            prompt,
            [{ role: 'user', content: prompt }],
            undefined,
            undefined,
            opts?.temperature ?? 0.3,
            'orchestrator'
          );
          const textBlock = response.content.find(block => block.type === 'text');
          return (textBlock as any)?.text || '';
        },
      },
      config
    );
  }

  private loadOrchestratorConfig(): DecomposerConfig {
    try {
      const config = GlobalConfig.get() as any;
      if (config.orchestratorConfig) {
        return { ...DEFAULT_DECOMPOSER_CONFIG, ...config.orchestratorConfig };
      }
    } catch {}
    return { ...DEFAULT_DECOMPOSER_CONFIG };
  }

  async planWorkflow(goal: string): Promise<Plan> {
    // 使用 Decomposer 进行智能拆解
    try {
      const decomposition = await this.decomposer.decompose(goal);

      const tasks: SubTask[] = decomposition.subtasks.map((t) => ({
        id: t.id,
        description: t.description,
        expectedOutput: t.expectedOutput,
        estimatedComplexity: t.estimatedComplexity,
        dependencies: t.dependencies,
        isolatedFiles: t.isolatedFiles,
        sharedFiles: t.sharedFiles,
      }));

      return {
        goal,
        tasks,
        parallelBatches: decomposition.parallelBatches.map((batch) =>
          batch.map((t) => tasks.find((task) => task.id === t.id)!)
        ),
        warnings: decomposition.warnings,
      };
    } catch (err: any) {
      // Decomposer 失败 → 回退到原有简单拆解
      workflowEvents.emit('log', {
        taskId: 'orchestrator',
        message: `Decomposer failed (${err.message}), falling back to simple planning...`,
      });
      return await this.planWorkflowSimple(goal);
    }
  }

  /** 原有简单拆解逻辑（作为回退） */
  private async planWorkflowSimple(goal: string): Promise<Plan> {
    const systemPrompt = `You are an expert orchestrator agent.
Your job is to break down the user's complex goal into independent sub-tasks that can be executed in parallel.
You must return a JSON object that matches this schema:
{
  "goal": "original goal summary",
  "tasks": [
    {
      "id": "task_1",
      "description": "Detailed description of the sub-task",
      "expectedOutput": "What the output of this task should be"
    }
  ]
}
Return ONLY valid JSON.`;

    const response = await askLLM(systemPrompt, [{ role: 'user', content: goal }], undefined, undefined, 0.7, 'orchestrator');

    const contentText = response.content.find(block => block.type === 'text');
    if (!contentText || contentText.type !== 'text') {
      throw new Error("Failed to get text response from LLM");
    }

    const text = contentText.text;
    const textWithoutThinking = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    let jsonString = textWithoutThinking;
    const jsonMatch = textWithoutThinking.match(/```json\n([\s\S]*?)\n```/) || textWithoutThinking.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    } else {
      const start = textWithoutThinking.indexOf('{');
      const end = textWithoutThinking.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        jsonString = textWithoutThinking.substring(start, end + 1);
      }
    }

    try {
      const plan = JSON.parse(jsonString) as Plan;
      return plan;
    } catch (err) {
      console.error("Failed to parse LLM response as JSON:", jsonString);
      throw err;
    }
  }

  async executeWorkflow(goal: string): Promise<string> {
    workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Planning Workflow...' });
    const plan = await this.planWorkflow(goal);

    workflowEvents.emit('workflowStarted', { goal: plan.goal, totalTasks: plan.tasks.length });

    if (plan.warnings && plan.warnings.length > 0) {
      for (const warning of plan.warnings) {
        workflowEvents.emit('log', { taskId: 'orchestrator', message: `⚠ ${warning}` });
      }
    }

    const retriever = new ToolRetriever();
    await retriever.init();

    // --- Token 预算分配 ---
    const budget = tokenBudget();
    const budgetConfig = (GlobalConfig.get() as any).budgetConfig;
    if (budgetConfig?.enabled && plan.tasks.some((t) => t.estimatedComplexity)) {
      budget.configure(budgetConfig);
      budget.allocateForTasks(plan.tasks as any);
    }

    const agentLogs: AgentExecutionLog[] = [];
    const results: TaskResult[] = [];

    // --- 拓扑分批执行 ---
    const batches = plan.parallelBatches || [plan.tasks];

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      workflowEvents.emit('log', {
        taskId: 'orchestrator',
        message: `Executing batch ${batchIndex + 1}/${batches.length} (${batch.length} tasks in parallel)...`,
      });

      const batchAgents: SubAgent[] = [];

      const batchPromises = batch.map(async (task) => {
        workflowEvents.emit('log', { taskId: task.id, message: `Retrieving tools...` });
        const tools = await retriever.getRelevantTools(task.description);
        workflowEvents.emit('taskStarted', { taskId: task.id, description: task.description });

        const agent = new SubAgent();
        batchAgents.push(agent);

        const result = await agent.execute(task, plan.goal, tools);
        agentLogs.push(agent.getExecutionLog());
        workflowEvents.emit('taskCompleted', { taskId: task.id, result: result.result, success: result.success });
        return result;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // 每批完成后做动态重分配
      for (const agent of batchAgents) {
        budget.rebalance(agent.getAgentId());
      }
    }

    // 收集冲突日志
    const conflictLog = fslock().getConflictLog();
    if (conflictLog.length > 0) {
      workflowEvents.emit('log', {
        taskId: 'orchestrator',
        message: `⚠ File conflicts detected: ${conflictLog.length} files written by multiple agents`,
      });
    }

    workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Verifying and Synthesizing...' });
    const verifier = new Verifier();
    const finalOutput = await verifier.verifyAndSynthesize(plan, results, agentLogs);

    workflowEvents.emit('workflowCompleted', { result: finalOutput });
    return finalOutput;
  }
}
