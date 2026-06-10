import * as p from '@clack/prompts';
import color from 'chalk';
import { Orchestrator } from '../core/orchestrator';
import { workflowEvents } from '../core/events';
import { GlobalConfig } from '../core/config';
import { StateManager } from '../core/stateManager';

export async function runInteractiveCLI() {
  p.intro(color.bgCyan(color.black(' Dynamic Workflow CLI ')));

  GlobalConfig.update({
    requireApproval: await p.confirm({
      message: 'Enable Human-in-the-Loop (HITL) approval for terminal commands?',
      initialValue: GlobalConfig.get().requireApproval
    }) as boolean
  });

  while (true) {
    const stateManager = new StateManager();
    const savedState = stateManager.loadState();
    let goal = '';
    let resume = false;

    if (savedState && savedState.goal && savedState.status === 'executing') {
      const shouldResume = await p.confirm({
        message: `Found an interrupted workflow for goal: "${savedState.goal.substring(0, 50)}...". Resume it?`,
        initialValue: true
      });

      if (shouldResume) {
        goal = savedState.goal;
        resume = true;
      } else {
        stateManager.clearState();
      }
    }

    if (!resume) {
      const inputGoal = await p.text({
        message: 'Enter your goal (or type "exit" to quit):',
        placeholder: 'Write a python script...',
      });

      if (p.isCancel(inputGoal) || inputGoal === 'exit' || !inputGoal) {
        p.outro('Goodbye!');
        process.exit(0);
      }
      goal = inputGoal as string;
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
      const result = await orchestrator.executeWorkflow(goal as string, { resume });
      
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
