import * as fs from 'fs';
import * as path from 'path';
import { Plan, TaskResult } from '../types/workflow';

export interface WorkflowState {
  goal: string;
  plan: Plan;
  results: TaskResult[];
  agentLogs: any[];
  status: 'planning' | 'executing' | 'verifying' | 'completed' | 'failed';
  currentBatchIndex: number;
}

export class StateManager {
  private stateFile: string;

  constructor(cwd: string = process.cwd()) {
    const workflowDir = path.join(cwd, '.workflow');
    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }
    this.stateFile = path.join(workflowDir, 'state.json');
  }

  saveState(state: WorkflowState): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2), 'utf-8');
  }

  loadState(): WorkflowState | null {
    if (fs.existsSync(this.stateFile)) {
      try {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        return JSON.parse(content) as WorkflowState;
      } catch (err) {
        console.error('Failed to parse workflow state file.');
      }
    }
    return null;
  }

  clearState(): void {
    if (fs.existsSync(this.stateFile)) {
      fs.unlinkSync(this.stateFile);
    }
  }
}
