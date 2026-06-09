import { askLLM } from '../llm/client';
import { Plan } from '../types/workflow';
import { SubAgent } from './agent';
import { Verifier } from './verifier';

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

    const response = await askLLM(systemPrompt, [{ role: 'user', content: goal }]);
    
    const contentText = response.content.find(block => block.type === 'text');
    if (!contentText || contentText.type !== 'text') {
      throw new Error("Failed to get text response from LLM");
    }

    const text = contentText.text;
    const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
    const jsonString = jsonMatch ? jsonMatch[1] : text;

    try {
      const plan = JSON.parse(jsonString) as Plan;
      return plan;
    } catch (err) {
      console.error("Failed to parse LLM response as JSON:", jsonString);
      throw err;
    }
  }

  async executeWorkflow(goal: string): Promise<string> {
    console.log(`\n=== Planning Workflow ===`);
    const plan = await this.planWorkflow(goal);
    console.log(`Goal: ${plan.goal}`);
    console.log(`Sub-tasks generated: ${plan.tasks.length}`);

    console.log(`\n=== Executing Sub-Agents in Parallel ===`);
    const agent = new SubAgent();
    const taskPromises = plan.tasks.map(task => {
      console.log(`Starting Task: [${task.id}] ${task.description}`);
      return agent.execute(task, plan.goal);
    });

    const results = await Promise.all(taskPromises);
    results.forEach(res => {
      console.log(`Task [${res.taskId}] completed with success=${res.success}`);
    });

    console.log(`\n=== Verifying and Synthesizing ===`);
    const verifier = new Verifier();
    const finalOutput = await verifier.verifyAndSynthesize(plan, results);
    
    return finalOutput;
  }
}
