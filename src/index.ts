import { Command } from 'commander';
import { Orchestrator } from './core/orchestrator';
import { runInteractiveCLI } from './cli/interactive';
import * as dotenv from 'dotenv';

dotenv.config();

const program = new Command();

program
  .name('dynamic-workflow')
  .description('A dynamic workflow orchestrator powered by LLMs')
  .version('1.0.0');

program
  .command('run')
  .description('Run a workflow based on a goal')
  .argument('<goal>', 'The goal to achieve')
  .action(async (goal: string) => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error("Error: ANTHROPIC_API_KEY is not set in the environment.");
        process.exit(1);
      }

      console.log(`Starting Dynamic Workflow for goal: "${goal}"`);
      const orchestrator = new Orchestrator();
      const result = await orchestrator.executeWorkflow(goal);
      
      console.log(`\n=== Final Synthesized Output ===`);
      console.log(result);
    } catch (err) {
      console.error("Workflow execution failed:", err);
      process.exit(1);
    }
  });

program
  .command('chat')
  .description('Start the interactive CLI session')
  .action(async () => {
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("Error: ANTHROPIC_API_KEY is not set in the environment.");
      process.exit(1);
    }
    await runInteractiveCLI();
  });

program.parse();
