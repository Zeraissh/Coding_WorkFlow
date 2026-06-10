import { Command } from 'commander';
import { Orchestrator } from './core/orchestrator';
import { runInteractiveCLI } from './cli/interactive';
import { runConfigCLI } from './cli/config';
import { GlobalConfig } from './core/config';
import { DashboardServer } from './dashboard/server';
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
  .option('-r, --resume', 'Resume from a previously interrupted state')
  .action(async (goal: string, options: { resume?: boolean }) => {
    try {
      let config = GlobalConfig.get();

      // Fallback to env var if file config is empty
      if (!config.apiKey && process.env.ANTHROPIC_API_KEY && config.provider === 'anthropic') {
        GlobalConfig.update({ apiKey: process.env.ANTHROPIC_API_KEY });
        config = GlobalConfig.get();
      }

      // Fallback: try env vars for other providers too
      if (!config.apiKey) {
        if (process.env.OPENAI_API_KEY && (config.provider === 'openai' || !config.provider)) {
          GlobalConfig.update({ apiKey: process.env.OPENAI_API_KEY, provider: 'openai' });
          config = GlobalConfig.get();
        } else if (process.env.DEEPSEEK_API_KEY && (config.provider === 'deepseek' || !config.provider)) {
          GlobalConfig.update({ apiKey: process.env.DEEPSEEK_API_KEY, provider: 'deepseek' });
          config = GlobalConfig.get();
        }
      }

      if (!config.apiKey) {
        console.log("No API Key configured. Redirecting to configuration setup...\n");
        await runConfigCLI();
        config = GlobalConfig.get();
        if (!config.apiKey) {
          console.error("Configuration aborted. Exiting.");
          process.exit(1);
        }
      }

      console.log(`Starting Dynamic Workflow for goal: "${goal}"`);

      const dashboard = new DashboardServer();
      dashboard.start(3000);
      console.log('\n[INFO] Dashboard running at http://localhost:3000\n');

      const orchestrator = new Orchestrator();
      const execOptions = options.resume ? { resume: true } : undefined;
      const result = await orchestrator.executeWorkflow(goal, execOptions);

      console.log(`\n=== Final Synthesized Output ===`);
      console.log(result);
    } catch (err) {
      console.error("Workflow execution failed:", err);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Configure LLM provider, model, and API keys')
  .action(async () => {
    await runConfigCLI();
  });

program
  .command('chat')
  .description('Start the interactive CLI session')
  .action(async () => {
    let config = GlobalConfig.get();
    
    // Fallback to env var if file config is empty
    if (!config.apiKey && process.env.ANTHROPIC_API_KEY && config.provider === 'anthropic') {
      GlobalConfig.update({ apiKey: process.env.ANTHROPIC_API_KEY });
      config = GlobalConfig.get();
    }

    if (!config.apiKey) {
      console.log("No API Key configured. Redirecting to configuration setup...\n");
      await runConfigCLI();
      config = GlobalConfig.get();
      if (!config.apiKey) {
        console.error("Configuration aborted. Exiting.");
        process.exit(1);
      }
    }
    
    const dashboard = new DashboardServer();
    dashboard.start(3000);
    console.log('\n[INFO] Dashboard running at http://localhost:3000\n');

    await runInteractiveCLI();
  });

program.parse();
