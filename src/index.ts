import { Command } from 'commander';
import { Orchestrator } from './core/orchestrator';
import { runInteractiveCLI } from './cli/interactive';
import { runConfigCLI } from './cli/config';
import { GlobalConfig } from './core/config';
import { startServer } from './server/index';
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
      
      startServer(3000);
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
  .command('eval')
  .description('Run the regression eval suite (.workflow/eval_suite/cases.json) and compare with the previous run')
  .option('-l, --label <label>', 'Label for this run (e.g. "after-rule-change")', '')
  .action(async (options: { label: string }) => {
    const { EvalSuite } = await import('./core/evalSuite');
    const suite = new EvalSuite();
    const cases = suite.loadCases();
    if (cases.length === 0) {
      console.log('No eval cases found. Add cases to .workflow/eval_suite/cases.json:');
      console.log(JSON.stringify([{
        id: 'example',
        goal: 'Create hello.py that prints hello world',
        assertions: [
          { type: 'file_exists', path: 'hello.py' },
          { type: 'file_contains', path: 'hello.py', text: 'hello world' },
        ],
      }], null, 2));
      return;
    }

    console.log(`Running ${cases.length} eval case(s)...\n`);
    const orchestrator = new Orchestrator();
    const result = await suite.run((goal) => orchestrator.executeWorkflow(goal), options.label);

    console.log(`\n=== Eval Suite Result ===`);
    console.log(`Passed: ${result.passed}/${result.total}`);
    for (const r of result.results) {
      console.log(`  ${r.passed ? '✅' : '❌'} ${r.caseId} (${(r.durationMs / 1000).toFixed(1)}s)`);
      for (const f of r.failures) console.log(`      ${f}`);
    }

    const comparison = suite.compareWithPrevious();
    if (comparison?.previous) {
      console.log(`\n=== vs Previous Run (${comparison.previous.label || new Date(comparison.previous.timestamp).toISOString()}) ===`);
      console.log(`Pass rate: ${comparison.previous.passed}/${comparison.previous.total} → ${result.passed}/${result.total}`);
      if (comparison.regressions.length > 0) {
        console.log(`⚠ REGRESSIONS: ${comparison.regressions.join(', ')}`);
        process.exitCode = 1;
      }
      if (comparison.improvements.length > 0) {
        console.log(`✨ Improvements: ${comparison.improvements.join(', ')}`);
      }
    }
  });

program
  .command('mcp-serve')
  .description('Expose the workflow engine as an MCP server over stdio (for Claude Code, Cursor, etc.)')
  .action(async () => {
    // stdio 传输下 stdout 是 JSON-RPC 信道：引擎所有 console.log 重定向到 stderr
    console.log = console.error;
    console.info = console.error;

    const { createMcpServer } = await import('./mcp/server');
    const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');

    const server = createMcpServer();
    await server.connect(new StdioServerTransport());
    console.error('[mcp-serve] coding-workflow MCP server running on stdio');
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
    
    startServer(3000);
    console.log('\n[INFO] Dashboard running at http://localhost:3000\n');

    await runInteractiveCLI();
  });

program.parse();
