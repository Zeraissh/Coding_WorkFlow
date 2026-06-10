"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Orchestrator = void 0;
const client_1 = require("../llm/client");
const workflow_1 = require("../types/workflow");
const agent_1 = require("./agent");
const verifier_1 = require("./verifier");
const retriever_1 = require("./retriever");
class Orchestrator {
    async planWorkflow(goal) {
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
        const response = await (0, client_1.askLLM)(systemPrompt, [{ role: 'user', content: goal }]);
        const contentText = response.content.find(block => block.type === 'text');
        if (!contentText || contentText.type !== 'text') {
            throw new Error("Failed to get text response from LLM");
        }
        const text = contentText.text;
        const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/) || text.match(/```\n([\s\S]*?)\n```/);
        const jsonString = jsonMatch ? jsonMatch[1] : text;
        try {
            const plan = JSON.parse(jsonString);
            return plan;
        }
        catch (err) {
            console.error("Failed to parse LLM response as JSON:", jsonString);
            throw err;
        }
    }
    async executeWorkflow(goal) {
        console.log(`\n=== Planning Workflow ===`);
        const plan = await this.planWorkflow(goal);
        console.log(`Goal: ${plan.goal}`);
        console.log(`Sub-tasks generated: ${plan.tasks.length}`);
        const retriever = new retriever_1.ToolRetriever();
        await retriever.init();
        console.log(`\n=== Executing Sub-Agents in Parallel ===`);
        const agent = new agent_1.SubAgent();
        const taskPromises = plan.tasks.map(async (task) => {
            console.log(`Retrieving tools for Task: [${task.id}]`);
            const tools = await retriever.getRelevantTools(task.description);
            console.log(`Task [${task.id}] acquired tools: ${tools.map(t => t.name).join(', ')}`);
            console.log(`Starting Task: [${task.id}] ${task.description}`);
            return agent.execute(task, plan.goal, tools);
        });
        const results = await Promise.all(taskPromises);
        results.forEach(res => {
            console.log(`Task [${res.taskId}] completed with success=${res.success}`);
        });
        console.log(`\n=== Verifying and Synthesizing ===`);
        const verifier = new verifier_1.Verifier();
        const finalOutput = await verifier.verifyAndSynthesize(plan, results);
        return finalOutput;
    }
}
exports.Orchestrator = Orchestrator;
//# sourceMappingURL=orchestrator.js.map