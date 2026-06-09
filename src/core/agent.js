"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SubAgent = void 0;
const client_1 = require("../llm/client");
const workflow_1 = require("../types/workflow");
const vector_store_1 = require("../tools/registry/vector_store");
const builtin_1 = require("../tools/builtin");
const client_2 = require("../mcp/client");
const messages_js_1 = require("@anthropic-ai/sdk/resources/messages.js");
class SubAgent {
    async execute(task, globalContext, toolRecords) {
        const systemPrompt = `You are an expert sub-agent.
Your goal is to execute a specific sub-task as part of a larger workflow.
Global Context: ${globalContext}

Sub-Task ID: ${task.id}
Description: ${task.description}
Expected Output: ${task.expectedOutput}

You have been provided with specific tools for this task. Use them if needed to gather information or perform actions.
Please provide the best possible output for this sub-task.`;
        const activeMcpClients = [];
        const anthropicTools = [];
        const toolExecutors = new Map();
        try {
            for (const record of toolRecords) {
                if (record.source === 'builtin') {
                    anthropicTools.push({
                        name: record.name,
                        description: record.description,
                        input_schema: record.schema
                    });
                    toolExecutors.set(record.name, async (args) => (0, builtin_1.executeBuiltinTool)(record.name, args));
                }
                else if (record.source === 'mcp' && record.mcpCommand) {
                    const client = new client_2.MCPClientWrapper(record.mcpCommand[0], record.mcpCommand.slice(1));
                    await client.connect();
                    activeMcpClients.push(client);
                    const mcpTools = await client.getTools();
                    for (const mTool of mcpTools) {
                        anthropicTools.push(mTool);
                        toolExecutors.set(mTool.name, async (args) => client.callTool(mTool.name, args));
                    }
                }
            }
            const response = await (0, client_1.askLLM)(systemPrompt, [{ role: 'user', content: "Execute the sub-task." }], anthropicTools, async (name, input) => {
                const executor = toolExecutors.get(name);
                if (executor) {
                    return await executor(input);
                }
                throw new Error(`Tool ${name} not found`);
            });
            const contentText = response.content.find(block => block.type === 'text');
            if (!contentText || contentText.type !== 'text') {
                throw new Error("Failed to get text response from LLM");
            }
            return {
                taskId: task.id,
                result: contentText.text,
                success: true
            };
        }
        catch (err) {
            return {
                taskId: task.id,
                result: "",
                success: false,
                error: err.message || String(err)
            };
        }
        finally {
            for (const client of activeMcpClients) {
                try {
                    await client.disconnect();
                }
                catch (e) { }
            }
        }
    }
}
exports.SubAgent = SubAgent;
//# sourceMappingURL=agent.js.map