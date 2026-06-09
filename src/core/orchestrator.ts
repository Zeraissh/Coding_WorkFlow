import { askLLM } from '../llm/client';
import { Plan } from '../types/workflow';
import { SubAgent } from './agent';
import { Verifier } from './verifier';
import { ToolRetriever } from './retriever';
import { workflowEvents } from './events';

export class Orchestrator {
  async planWorkflow(goal: string): Promise<Plan> {
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

    let jsonString = text;
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
    if (jsonMatch) {
      jsonString = jsonMatch[1];
    } else {
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start !== -1 && end !== -1 && end > start) {
        jsonString = text.substring(start, end + 1);
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

    const retriever = new ToolRetriever();
    await retriever.init();

    workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Executing Sub-Agents in Parallel...' });
    const agent = new SubAgent();
    const taskPromises = plan.tasks.map(async task => {
      workflowEvents.emit('log', { taskId: task.id, message: `Retrieving tools...` });
      const tools = await retriever.getRelevantTools(task.description);
      workflowEvents.emit('taskStarted', { taskId: task.id, description: task.description });
      
      const result = await agent.execute(task, plan.goal, tools);
      workflowEvents.emit('taskCompleted', { taskId: task.id, result: result.result, success: result.success });
      return result;
    });

    const results = await Promise.all(taskPromises);

    workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Verifying and Synthesizing...' });
    const verifier = new Verifier();
    const finalOutput = await verifier.verifyAndSynthesize(plan, results);
    
    workflowEvents.emit('workflowCompleted', { result: finalOutput });
    return finalOutput;
  }
}
