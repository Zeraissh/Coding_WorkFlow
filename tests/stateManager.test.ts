import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { StateManager, WorkflowState } from '../src/core/stateManager';

let tmpDir: string;

const sampleState: WorkflowState = {
  goal: 'test goal',
  plan: { tasks: [] } as any,
  results: [],
  agentLogs: [],
  status: 'executing',
  currentBatchIndex: 1,
};

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-state-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('StateManager', () => {
  it('round-trips state through save and load', () => {
    const sm = new StateManager(tmpDir);
    sm.saveState(sampleState);
    expect(sm.loadState()).toEqual(sampleState);
  });

  it('does not leave a tmp file behind after save', () => {
    const sm = new StateManager(tmpDir);
    sm.saveState(sampleState);
    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'state.json.tmp'))).toBe(false);
  });

  it('returns null for truncated/corrupt JSON instead of throwing', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.workflow', 'state.json'), '{"goal": "tru', 'utf-8');
    expect(sm.loadState()).toBeNull();
  });

  it('returns null for valid JSON with wrong shape', () => {
    const sm = new StateManager(tmpDir);
    fs.writeFileSync(path.join(tmpDir, '.workflow', 'state.json'), JSON.stringify({ foo: 1 }), 'utf-8');
    expect(sm.loadState()).toBeNull();
  });

  it('returns null when no state exists', () => {
    const sm = new StateManager(tmpDir);
    expect(sm.loadState()).toBeNull();
  });

  it('clearState removes state and any stale tmp file', () => {
    const sm = new StateManager(tmpDir);
    sm.saveState(sampleState);
    fs.writeFileSync(path.join(tmpDir, '.workflow', 'state.json.tmp'), 'stale', 'utf-8');
    sm.clearState();
    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'state.json'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'state.json.tmp'))).toBe(false);
  });
});
