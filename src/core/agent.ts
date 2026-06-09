import { askLLM } from '../llm/client';
import { SubTask, TaskResult } from '../types/workflow';

export class SubAgent {
  async execute(task: SubTask, globalContext: string): Promise<TaskResult> {
    const systemPrompt = `You are an expert sub-agent.
Your goal is to execute a specific sub-task as part of a larger workflow.
Global Context: ${globalContext}

Sub-Task ID: ${task.id}
Description: ${task.description}
Expected Output: ${task.expectedOutput}

Please provide the best possible output for this sub-task.`;

    try {
      const response = await askLLM(systemPrompt, [{ role: 'user', content: "Execute the sub-task." }]);
      
      const contentText = response.content.find(block => block.type === 'text');
      if (!contentText || contentText.type !== 'text') {
        throw new Error("Failed to get text response from LLM");
      }

      return {
        taskId: task.id,
        result: contentText.text,
        success: true
      };
    } catch (err: any) {
      return {
        taskId: task.id,
        result: "",
        success: false,
        error: err.message || String(err)
      };
    }
  }
}
