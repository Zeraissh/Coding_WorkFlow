import * as p from '@clack/prompts';
import color from 'chalk';
import { Orchestrator } from '../core/orchestrator';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';

export async function runInteractiveCLI() {
  p.intro(color.bgCyan(color.black(' Dynamic Workflow CLI ')));

  GlobalConfig.requireApproval = await p.confirm({
    message: 'Enable Human-in-the-Loop (HITL) approval for terminal commands?',
    initialValue: true
  }) as boolean;

  while (true) {
    const goal = await p.text({
      message: 'Enter your goal (or type "exit" to quit):',
      placeholder: 'Write a python script...',
    });

    if (p.isCancel(goal) || goal === 'exit' || !goal) {
      p.outro('Goodbye!');
      process.exit(0);
    }

    const s = p.spinner();
    s.start('Planning Workflow...');

    const onWorkflowStarted = (data: any) => {
      s.message(`Executing ${data.totalTasks} tasks in parallel...`);
    };

    const onLog = (data: any) => {
      s.message(`[${data.taskId}] ${data.message.slice(0, 50)}...`);
    };

    const onApprovalRequested = async (data: any) => {
      s.stop('Approval required.');
      p.log.warn(`Task [${data.taskId}] wants to execute ${data.toolName}:`);
      p.log.message(color.gray(JSON.stringify(data.arguments, null, 2)));
      
      const approved = await p.confirm({ message: 'Approve execution?' });
      if (approved) {
        p.log.success('Approved.');
        s.start('Resuming execution...');
        data.resolve();
      } else {
        p.log.error('Rejected.');
        s.start('Resuming execution...');
        data.reject(new Error('User rejected the execution.'));
      }
    };

    workflowEvents.on('workflowStarted', onWorkflowStarted);
    workflowEvents.on('log', onLog);
    workflowEvents.on('approvalRequested', onApprovalRequested);

    try {
      const orchestrator = new Orchestrator();
      const result = await orchestrator.executeWorkflow(goal as string);
      
      s.stop('Workflow completed!');
      p.note(result, 'Final Output');
    } catch (err: any) {
      s.stop('Workflow failed!');
      p.log.error(err.message || String(err));
    } finally {
      workflowEvents.off('workflowStarted', onWorkflowStarted);
      workflowEvents.off('log', onLog);
      workflowEvents.off('approvalRequested', onApprovalRequested);
    }
  }
}
