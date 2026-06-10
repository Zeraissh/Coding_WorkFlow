"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Verifier = void 0;
const client_1 = require("../llm/client");
const workflow_1 = require("../types/workflow");
class Verifier {
    async verifyAndSynthesize(plan, results) {
        const systemPrompt = `You are an expert verifier and synthesizer.
Your task is to review the results of parallel sub-tasks and synthesize them into a final response.

Original Goal: ${plan.goal}

Sub-Task Results:
${JSON.stringify(results, null, 2)}

Please provide a final, coherent answer or output that achieves the original goal, based solely on the sub-task results.
If any sub-tasks failed, attempt to work around the failure or mention what is missing.`;
        const response = await (0, client_1.askLLM)(systemPrompt, [{ role: 'user', content: 'Please synthesize the results.' }]);
        const contentText = response.content.find(block => block.type === 'text');
        if (!contentText || contentText.type !== 'text') {
            throw new Error("Failed to get text response from LLM");
        }
        return contentText.text;
    }
}
exports.Verifier = Verifier;
//# sourceMappingURL=verifier.js.map