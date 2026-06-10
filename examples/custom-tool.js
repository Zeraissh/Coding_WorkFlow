import { Orchestrator } from '../src/core/orchestrator';
import { GlobalConfig } from '../src/core/config';
import { builtinTools, executeBuiltinTool } from '../src/tools/builtin';
// 1. Define the custom tool schema using JSON Schema format
const customTimeTool = {
    name: 'get_current_time',
    description: 'Retrieves the current system time. Use this when the user asks for the time.',
    input_schema: {
        type: 'object',
        properties: {
            timezone: {
                type: 'string',
                description: 'Optional timezone (e.g., UTC, EST). Defaults to local time.',
            }
        }
    }
};
// 2. Mocking tool injection
// Note: In the full framework, custom tools can be injected natively via MCP servers
// or by registering them in the ToolRegistry. For this example, we demonstrate 
// adding it directly to the built-ins list (for illustrative purposes).
builtinTools.push(customTimeTool);
const originalExecute = executeBuiltinTool;
global.executeBuiltinTool = async (name, args, agentId) => {
    if (name === 'get_current_time') {
        return `The current time is: ${new Date().toISOString()}`;
    }
    return originalExecute(name, args, agentId);
};
async function main() {
    const config = GlobalConfig.get();
    if (!config.apiKey) {
        console.error("Please configure your API Key using: npx autocode config");
        process.exit(1);
    }
    const orchestrator = new Orchestrator();
    const goal = "What time is it right now? Please write it to a file named current_time.txt.";
    console.log(`\nStarting Workflow Execution for goal: "${goal}"\n`);
    try {
        const result = await orchestrator.executeWorkflow(goal);
        console.log("\n====== Workflow Completed Successfully ======\n");
        console.log(result);
    }
    catch (err) {
        console.error("\n====== Workflow Failed ======\n");
        console.error(err.message);
    }
}
main().then(() => process.exit(0));
//# sourceMappingURL=custom-tool.js.map