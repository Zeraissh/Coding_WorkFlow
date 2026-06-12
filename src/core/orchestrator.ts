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
import { getProjectMemory, extractLessons } from './memory';
import { gitCreateBranch, gitCommitAll } from '../tools/git_tool';
import { ProjectIndexer } from './indexer';
import { StateManager, WorkflowState } from './stateManager';
import { beginWorkflowAbortScope, endWorkflowAbortScope, isWorkflowStopped } from './abort';
import { Clarifier, ClarifyAnswer } from './orchestrator/clarifier';
import { RuleStore } from './rules';
import { KnowledgeStore } from './knowledge';
import { SkillRegistry } from './skills';
import { RepoMap } from './repomap';
import { SnapshotManager } from './snapshotManager';
import { MCPRegistry } from '../mcp/registry';
import { PluginManager } from './pluginManager';
import { TemplateManager } from './templates';
import { safeListDir, executeBuiltinTool } from '../tools/builtin';

/**
 * Executes a set of async tasks with a maximum concurrency limit.
 *
 * @template T - The return type of the asynchronous operation.
 * @param {number} poolLimit - The maximum number of concurrent executions.
 * @param {any[]} array - The array of items to process.
 * @param {(item: any) => Promise<T>} iteratorFn - The async function applied to each item.
 * @returns {Promise<T[]>} A promise that resolves with an array of all execution results.
 */
async function asyncPool<T>(poolLimit: number, array: any[], iteratorFn: (item: any) => Promise<T>): Promise<T[]> {
  const ret: Promise<T>[] = [];
  const executing: Promise<void>[] = [];
  for (const item of array) {
    const p = Promise.resolve().then(() => iteratorFn(item));
    ret.push(p);
    if (poolLimit <= array.length) {
      const e: Promise<void> = p.then(() => { executing.splice(executing.indexOf(e), 1); });
      executing.push(e);
      if (executing.length >= poolLimit) {
        await Promise.race(executing);
      }
    }
  }
  return Promise.all(ret);
}

/**
 * The core orchestration engine that handles dynamic goal decomposition,
 * sub-agent dispatching, concurrency control, and continuous verification.
 */
export class Orchestrator {
  private decomposer: Decomposer;
  private pluginManager: PluginManager;
  private templateManager: TemplateManager;
  /** 本次工作流命中的 skill（用于结束时回写胜负） */
  private matchedSkillId: string | null = null;

  /**
   * Initializes a new Orchestrator instance. Loads the default decomposer configuration
   * and prepares the internal LLM caller required for decomposing goals into atomic tasks.
   */
  constructor() {
    this.pluginManager = new PluginManager();
    this.pluginManager.loadAll().catch((e: any) => {
      console.warn(`[orchestrator] Plugin loading failed: ${e.message}`);
    });
    this.templateManager = new TemplateManager();

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
    } catch (e: any) {
      console.warn(`[orchestrator] Failed to load orchestrator config, using defaults: ${e.message}`);
    }
    return { ...DEFAULT_DECOMPOSER_CONFIG };
  }

  /**
   * Clarify Phase：复杂且模糊的目标先转化为选项式问题，
   * 答案固化为需求规格（.workflow/requirements.md）作为分解契约。
   * 返回注入分解上下文的需求规格文本（不触发时返回空串）。
   */
  private async runClarifyPhase(goal: string): Promise<string> {
    const rawConfig = (GlobalConfig.get() as any).clarifyConfig || {};
    const clarifier = new Clarifier(
      {
        callLLM: async (prompt, opts) => {
          const response = await askLLM(
            prompt,
            [{ role: 'user', content: prompt }],
            undefined, undefined,
            opts?.temperature ?? 0.2,
            'orchestrator'
          );
          const block = response.content.find(b => b.type === 'text');
          return (block as any)?.text || '';
        },
        searchWeb: async (query) => executeBuiltinTool('search_web', { query }),
      },
      rawConfig
    );

    const assessment = await clarifier.assessGaps(goal);
    if (!clarifier.needsClarification(assessment)) return '';

    workflowEvents.emit('log', {
      taskId: 'orchestrator',
      message: `🔍 Goal is complex (${assessment.complexityEstimate}/10) with gaps [${assessment.missingDimensions.join(', ')}] — entering clarify phase...`,
    });

    const { questions, researchNotes } = await clarifier.generateQuestions(goal, assessment);
    if (questions.length === 0) return '';

    let answers: ClarifyAnswer[];
    const hasInteractiveListener = workflowEvents.listenerCount('clarificationRequested') > 0;

    if (rawConfig.auto || !hasInteractiveListener) {
      answers = clarifier.autoAnswer(questions);
      workflowEvents.emit('log', {
        taskId: 'orchestrator',
        message: `Auto mode: adopted ${answers.length} recommended options (recorded as assumptions).`,
      });
    } else {
      // 交互模式：CLI / Dashboard 应答，5 分钟无响应降级为 auto
      answers = await new Promise<ClarifyAnswer[]>((resolve) => {
        const timer = setTimeout(() => {
          workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Clarification timed out — falling back to recommended options.' });
          resolve(clarifier.autoAnswer(questions));
        }, 5 * 60 * 1000);
        workflowEvents.emit('clarificationRequested', {
          goal,
          questions,
          resolve: (userAnswers: ClarifyAnswer[]) => {
            clearTimeout(timer);
            resolve(userAnswers);
          },
        });
      });
    }

    const doc = clarifier.buildRequirementsDoc(goal, questions, answers, researchNotes);
    const savedPath = clarifier.saveRequirementsDoc(doc);
    // 同步入知识库：后续所有子 Agent 可通过 query_knowledge 检索这些决策
    try {
      new KnowledgeStore().addDocument(`需求规格: ${goal.slice(0, 40)}`, doc, 'clarify-phase');
    } catch (e: any) {
      console.warn(`[orchestrator] Failed to ingest requirements into knowledge base: ${e.message}`);
    }
    workflowEvents.emit('log', { taskId: 'orchestrator', message: `📋 Requirements spec saved to ${savedPath}` });

    return doc;
  }

  async planWorkflow(goal: string): Promise<Plan> {
    const templatePlan = this.templateManager.matchTemplate(goal);
    if (templatePlan) {
      workflowEvents.emit('workflowStarted', { goal });
      return templatePlan;
    }

    // --- Clarify Phase（模板匹配之后、分解之前） ---
    let requirementsContext = '';
    try {
      requirementsContext = await this.runClarifyPhase(goal);
    } catch (e: any) {
      console.warn(`[orchestrator] Clarify phase failed, proceeding without it: ${e.message}`);
    }

    // 使用 Decomposer 进行智能拆解
    try {
      // --- Local RAG ---
      const indexer = new ProjectIndexer();
      await indexer.scanAndIndex();
      const relevantCode = await indexer.search(goal, 3);
      
      let ragContext = '';
      if (relevantCode.length > 0) {
        ragContext = '\n\n【Local RAG 代码上下文片段】\n' + relevantCode.map(c => `// ${c.file}:${c.startLine}\n${c.content}`).join('\n\n');
      }

      // Inject Repo Map（符号地图，信息密度优于目录树；空仓库回退目录树）
      let projectMapContext = '';
      try {
        const repoMapText = new RepoMap().render();
        if (repoMapText) {
          projectMapContext = `\n\n【Repo Map (file → top-level symbols)】\n${repoMapText}`;
        }
      } catch (e: any) {
        console.warn(`[orchestrator] Repo map failed: ${e.message}`);
      }
      if (!projectMapContext) {
        const projectMapLines = safeListDir(process.cwd(), 2);
        projectMapContext = projectMapLines.length > 0
          ? `\n\n【Project Directory Map (Depth 2)】\n${projectMapLines.join('\n')}`
          : '';
      }

      const requirementsSection = requirementsContext
        ? `\n\n【需求规格（Clarify Phase 产出，分解必须遵循）】\n${requirementsContext}`
        : '';

      // --- Skill 匹配：命中的领域上下文包注入分解上下文 ---
      let skillSection = '';
      try {
        const matchedSkill = new SkillRegistry().matchSkill(goal);
        if (matchedSkill) {
          this.matchedSkillId = matchedSkill.id;
          skillSection = `\n\n【Skill: ${matchedSkill.name}（领域经验，遵循其约定）】\n${matchedSkill.promptAddition}`;
          workflowEvents.emit('skillMatched', { skillId: matchedSkill.id, name: matchedSkill.name });
          workflowEvents.emit('log', { taskId: 'orchestrator', message: `🧩 Matched skill: ${matchedSkill.name}` });
        }
      } catch (e: any) {
        console.warn(`[orchestrator] Skill matching failed: ${e.message}`);
      }

      const projectMemory = getProjectMemory() + requirementsSection + skillSection + ragContext + projectMapContext;
      const decomposition = await this.decomposer.decompose(goal, projectMemory);

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

    // --- Local RAG ---
    const indexer = new ProjectIndexer();
    await indexer.scanAndIndex();
    const relevantCode = await indexer.search(goal, 3);
    let ragContext = '';
    if (relevantCode.length > 0) {
      ragContext = '\n\n【Local RAG 代码上下文片段】\n' + relevantCode.map(c => `// ${c.file}:${c.startLine}\n${c.content}`).join('\n\n');
    }

    const projectMapLines = safeListDir(process.cwd(), 2);
    const projectMapContext = projectMapLines.length > 0 
      ? `\n\n【Project Directory Map (Depth 2)】\n${projectMapLines.join('\n')}` 
      : '';

    const projectMemory = getProjectMemory() + ragContext + projectMapContext;
    const finalSystemPrompt = projectMemory
      ? systemPrompt + `\n\nProject Memory (Strictly follow these rules):\n${projectMemory}`
      : systemPrompt;

    const response = await askLLM(finalSystemPrompt, [{ role: 'user', content: goal }], undefined, undefined, 0.7, 'orchestrator');

    const contentText = response.content.find(block => block.type === 'text');
    if (!contentText || contentText.type !== 'text') {
      throw new Error("Failed to get text response from LLM");
    }

    const text = contentText.text;
    const textWithoutThinking = text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '');
    let jsonString = textWithoutThinking;
    const jsonMatch = textWithoutThinking.match(/```json\n([\s\S]*?)\n```/) || textWithoutThinking.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch && jsonMatch[1]) {
      jsonString = jsonMatch[1];
    } else {
      const start = textWithoutThinking.indexOf('{');
      const end = textWithoutThinking.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        jsonString = textWithoutThinking.substring(start, end + 1);
      }
    }

    try {
      // Heuristic: Remove trailing commas before closing brackets/braces
      jsonString = jsonString.replace(/,\s*([\]}])/g, '$1');
      const plan = JSON.parse(jsonString) as Plan;
      return plan;
    } catch (err) {
      workflowEvents.emit('log', {
        taskId: 'orchestrator',
        message: `⚠ Failed to parse LLM response as JSON. Falling back to a default single-task plan.`,
      });
      return {
        goal,
        tasks: [
          {
            id: 'fallback-execute-1',
            description: `Complete the following goal: ${goal}`,
            expectedOutput: 'The requested task is completed successfully.'
          }
        ]
      };
    }
  }

  /**
   * Executes the provided goal by dynamically generating a plan, provisioning tools,
   * launching SubAgents concurrently, and verifying the final output.
   *
   * @param {string} goal - The user's requested objective.
   * @param {{ resume?: boolean }} [options] - Optional configuration, such as resuming a halted workflow.
   * @returns {Promise<string>} The final verified summary string describing the outcome.
   */
  async executeWorkflow(goal: string, options?: { resume?: boolean }): Promise<string> {
    beginWorkflowAbortScope();
    try {
      return await this.executeWorkflowInner(goal, options);
    } finally {
      endWorkflowAbortScope();
    }
  }

  private async executeWorkflowInner(goal: string, options?: { resume?: boolean }): Promise<string> {
    const stateManager = new StateManager();
    let state = options?.resume ? stateManager.loadState() : null;

    let plan: Plan;
    let results: TaskResult[] = [];
    let agentLogs: AgentExecutionLog[] = [];
    let startBatchIndex = 0;
    const snapshotManager = new SnapshotManager();

    if (state && state.goal === goal) {
      workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Resuming previous workflow state...' });
      plan = state.plan;
      results = state.results;
      agentLogs = state.agentLogs;
      startBatchIndex = state.currentBatchIndex;
    } else {
      workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Planning Workflow...' });
      plan = await this.planWorkflow(goal);

      state = {
        goal,
        plan,
        results: [],
        agentLogs: [],
        status: 'executing',
        currentBatchIndex: 0
      };
      stateManager.saveState(state);

      workflowEvents.emit('workflowStarted', { goal: plan.goal, totalTasks: plan.tasks.length });

      // --- Git Branching ---
      // 为当前任务创建一个独立分支
      const safeGoal = plan.goal.replace(/[^a-zA-Z0-9]/g, '-').substring(0, 20).replace(/-+$/, '');
      const branchName = `autocode/task-${Date.now()}-${safeGoal}`;
      workflowEvents.emit('log', { taskId: 'orchestrator', message: `Creating git branch: ${branchName}` });
      await gitCreateBranch(branchName);

      if (plan.warnings && plan.warnings.length > 0) {
        for (const warning of plan.warnings) {
          workflowEvents.emit('log', { taskId: 'orchestrator', message: `⚠ ${warning}` });
        }
      }
      
      workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Creating atomic snapshot backup...' });
      snapshotManager.createSnapshot();
    }

    workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Initializing Global MCP Ecosystem...' });
    await MCPRegistry.getInstance().init();

    const retriever = new ToolRetriever();
    await retriever.init();

    // --- Token 预算分配 ---
    const budget = tokenBudget();
    const budgetConfig = (GlobalConfig.get() as any).budgetConfig;
    if (budgetConfig?.enabled && plan.tasks.some((t) => t.estimatedComplexity)) {
      budget.configure(budgetConfig);
      budget.allocateForTasks(plan.tasks as any);
    }

    // --- 拓扑分批执行 ---
    const batches = plan.parallelBatches || [plan.tasks];

    for (let batchIndex = startBatchIndex; batchIndex < batches.length; batchIndex++) {
      // --- E-Stop 检查：批次边界是安全停止点，状态已落盘可 resume ---
      if (isWorkflowStopped()) {
        state!.status = 'failed';
        stateManager.saveState(state!);
        workflowEvents.emit('log', {
          taskId: 'orchestrator',
          message: '🛑 Workflow stopped by user. State saved — use resume to continue.',
        });
        return 'Workflow stopped by user before batch ' + (batchIndex + 1) + '. Progress saved, resumable.';
      }

      const batch = batches[batchIndex]!;
      workflowEvents.emit('log', {
        taskId: 'orchestrator',
        message: `Executing batch ${batchIndex + 1}/${batches.length} (${batch!.length} tasks in parallel)...`,
      });

      const batchAgents: SubAgent[] = [];

      const poolSize = GlobalConfig.get().agentConfig?.parallelPoolSize ?? 5;
      const batchResults = await asyncPool(poolSize, batch!, async (task) => {
        workflowEvents.emit('log', { taskId: task.id, message: `Retrieving tools...` });
        const tools = await retriever.getRelevantTools(task.description);
        workflowEvents.emit('taskStarted', { taskId: task.id, description: task.description });

        const agent = new SubAgent();
        batchAgents.push(agent);

        const result = await agent.execute(task, plan.goal, tools);
        agentLogs.push(agent.getExecutionLog());
        workflowEvents.emit('taskCompleted', { 
          taskId: task.id, 
          result: result.result, 
          success: result.success,
          agentId: result.agentId,
          executionLog: result.executionLog
        });
        return result;
      });

      results.push(...batchResults);

      // 保存状态
      state!.results = results;
      state!.agentLogs = agentLogs;
      state!.currentBatchIndex = batchIndex + 1;
      stateManager.saveState(state!);

      // 每批完成后标记完成（内部会自动触发动态重分配）
      for (const agent of batchAgents) {
        budget.markCompleted(agent.getAgentId());
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

    // Memory Extraction Phase
    extractLessons(goal, agentLogs).catch(console.error);

    // 规则生命周期：成功工作流刷新相关域规则的验证时间，长期未验证的进入待退役
    const workflowSuccess = results.every(r => r.success);
    try {
      const ruleStore = new RuleStore();
      const corpus = (goal + ' ' + plan.tasks.map(t => t.description).join(' ')).toLowerCase();
      const touchedDomains = [...new Set(
        ruleStore.getActive().flatMap(r => r.domains).filter(d => corpus.includes(d.toLowerCase()))
      )];
      ruleStore.onWorkflowCompleted(touchedDomains, workflowSuccess);
    } catch (e: any) {
      console.warn(`[orchestrator] Rule lifecycle pass failed: ${e.message}`);
    }

    // Skill 胜率闭环：回写命中 skill 的成败；成功的无 skill 目标进入起草观察
    try {
      const registry = new SkillRegistry();
      if (this.matchedSkillId) {
        registry.recordOutcome(this.matchedSkillId, workflowSuccess);
        this.matchedSkillId = null;
      } else if (workflowSuccess) {
        // fire-and-forget：起草不阻塞工作流收尾
        registry.considerDraft(goal, async (prompt) => {
          const response = await askLLM(prompt, [{ role: 'user', content: prompt }], undefined, undefined, 0.3, 'orchestrator');
          const block = response.content.find(b => b.type === 'text');
          return (block as any)?.text || '';
        }).then(draft => {
          if (draft) {
            workflowEvents.emit('log', {
              taskId: 'orchestrator',
              message: `🧩 Skill draft proposed: "${draft.name}" — review and activate it in .workflow/skills/`,
            });
          }
        }).catch((e: any) => console.warn(`[orchestrator] Skill drafting failed: ${e.message}`));
      }
    } catch (e: any) {
      console.warn(`[orchestrator] Skill outcome pass failed: ${e.message}`);
    }

    // --- Human-in-the-Loop Review ---
    const { gitDiffCheck } = await import('../tools/git_tool');
    const diffText = await gitDiffCheck();
    if (diffText && diffText.trim().length > 0) {
      workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Waiting for User Approval via Dashboard...' });
      
      const approved = await new Promise<boolean>((resolve) => {
        const handler = (data: { taskId: string, approved: boolean }) => {
          if (data.taskId === 'orchestrator') {
            workflowEvents.off('dashboardApproval', handler);
            resolve(data.approved);
          }
        };
        workflowEvents.on('dashboardApproval', handler);
        workflowEvents.emit('reviewRequested', { taskId: 'orchestrator', diff: diffText, finalOutput });
      });

      if (!approved) {
        workflowEvents.emit('log', { taskId: 'orchestrator', message: 'User rejected the changes. Rolling back snapshot...' });
        snapshotManager.rollback();
        workflowEvents.emit('workflowCompleted', { result: 'User rejected the changes. Code has been rolled back.' });
        stateManager.clearState();
        return 'Workflow rejected by user. Rolled back successfully.';
      }
    }

    // --- Git Committing ---
    workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Committing changes to git...' });
    const commitMsg = `feat: ${plan.goal.substring(0, 50)}\n\n${finalOutput.substring(0, 200)}...`;
    await gitCommitAll(commitMsg);

    const report = tokenBudget().getReport();
    workflowEvents.emit('workflowCompleted', { 
      result: finalOutput,
      tokensSpent: report.totalSpent,
      diff: diffText
    });
    
    // 清理状态
    stateManager.clearState();
    snapshotManager.prune();
    return finalOutput;
  }
}
