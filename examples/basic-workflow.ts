import { Orchestrator } from '../src/core/orchestrator';
import { GlobalConfig } from '../src/core/config';

async function main() {
  // Ensure we have a valid API Key config
  const config = GlobalConfig.get();
  if (!config.apiKey) {
    console.error("Please configure your API Key using: npx autocode config");
    process.exit(1);
  }

  console.log(`Using Provider: ${config.provider} | Model: ${config.model}`);
  
  // Initialize the orchestrator
  const orchestrator = new Orchestrator();

  const goal = "Create a new file named hello-world.txt containing 'Hello, World!' and verify its contents.";
  console.log(`\nStarting Workflow Execution for goal: "${goal}"\n`);

  try {
    // This handles the entire lifecycle: Decomposing the goal, launching agents,
    // handling tools/MCPs, and returning the final summary.
    const result = await orchestrator.executeWorkflow(goal);
    
    console.log("\n====== Workflow Completed Successfully ======\n");
    console.log(result);
  } catch (err: any) {
    console.error("\n====== Workflow Failed ======\n");
    console.error(err.message);
  }
}

// Ensure the process exits cleanly after finishing
main().then(() => process.exit(0));
