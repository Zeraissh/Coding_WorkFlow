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

const VALID_STATUSES = ['planning', 'executing', 'verifying', 'completed', 'failed'];

function isValidState(obj: any): obj is WorkflowState {
  return (
    obj !== null &&
    typeof obj === 'object' &&
    typeof obj.goal === 'string' &&
    obj.plan !== null && typeof obj.plan === 'object' &&
    Array.isArray(obj.results) &&
    Array.isArray(obj.agentLogs) &&
    VALID_STATUSES.includes(obj.status) &&
    typeof obj.currentBatchIndex === 'number'
  );
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
    // 先写临时文件再 rename，避免进程中断留下半截 JSON 导致 resume 失败
    const tmpFile = `${this.stateFile}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8');
    fs.renameSync(tmpFile, this.stateFile);
  }

  loadState(): WorkflowState | null {
    if (fs.existsSync(this.stateFile)) {
      try {
        const content = fs.readFileSync(this.stateFile, 'utf-8');
        const parsed = JSON.parse(content);
        if (!isValidState(parsed)) {
          console.error('Workflow state file is malformed; ignoring it.');
          return null;
        }
        return parsed;
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
    const tmpFile = `${this.stateFile}.tmp`;
    if (fs.existsSync(tmpFile)) {
      fs.unlinkSync(tmpFile);
    }
  }
}
