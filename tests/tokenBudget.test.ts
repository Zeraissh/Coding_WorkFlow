import { describe, it, expect, beforeEach } from 'vitest';
import { TokenBudgetManager } from '../src/core/tokenBudget';
import type { Subtask } from '../src/core/orchestrator/types';

function makeTask(id: string, complexity: number): Subtask {
  return {
    id,
    description: `task ${id}`,
    estimatedComplexity: complexity,
    dependencies: [],
    isolatedFiles: [],
    sharedFiles: [],
    expectedOutput: '',
  };
}

let manager: TokenBudgetManager;

beforeEach(() => {
  TokenBudgetManager.resetInstance();
  manager = TokenBudgetManager.getInstance();
  manager.configure({
    enabled: true,
    totalTokens: 100_000,
    autoRebalance: true,
    verifierReservePercent: 10,
  });
});

describe('TokenBudgetManager.allocateForTasks', () => {
  it('allocates the pool minus the verifier reserve, weighted by complexity', () => {
    const allocations = manager.allocateForTasks([makeTask('a', 3), makeTask('b', 6)]);
    expect(allocations).toHaveLength(2);

    const total = allocations.reduce((sum, a) => sum + a.allocatedTokens, 0);
    expect(total).toBeLessThanOrEqual(90_000); // 10% 预留给 Verifier/Orchestrator
    expect(total).toBeGreaterThan(85_000);

    const byTask = new Map(allocations.map(a => [a.subtaskId, a.allocatedTokens]));
    // b 的复杂度是 a 的两倍 → 配额约两倍
    expect(byTask.get('b')! / byTask.get('a')!).toBeCloseTo(2, 1);
  });

  it('returns no allocations when disabled', () => {
    manager.configure({ enabled: false });
    expect(manager.allocateForTasks([makeTask('a', 5)])).toEqual([]);
  });
});

describe('TokenBudgetManager usage tracking', () => {
  it('tracks per-agent usage and reports budget levels through checkBudget', () => {
    const [alloc] = manager.allocateForTasks([makeTask('a', 5)]);
    const agentId = alloc!.agentId;

    let check = manager.checkBudget(agentId);
    expect(check.canContinue).toBe(true);
    expect(check.spent).toBe(0);

    manager.reportUsage(agentId, Math.floor(alloc!.allocatedTokens * 0.5));
    check = manager.checkBudget(agentId);
    expect(check.canContinue).toBe(true);
    expect(check.level).toBe('normal');

    // 推到 exhaust 阈值 (95%) 之上
    manager.reportUsage(agentId, Math.ceil(alloc!.allocatedTokens * 0.5));
    check = manager.checkBudget(agentId);
    expect(check.canContinue).toBe(false);
  });

  it('emits threshold events as usage crosses watermarks', () => {
    const [alloc] = manager.allocateForTasks([makeTask('a', 5)]);
    const events: string[] = [];
    manager.onBudgetEvent(e => events.push(e.type));

    manager.reportUsage(alloc!.agentId, Math.ceil(alloc!.allocatedTokens * 0.75));
    manager.checkBudget(alloc!.agentId);
    expect(events).toContain('warning');
  });

  it('getUsage works even without an allocation (fallback tracking)', () => {
    manager.reportUsage('orchestrator', 1234);
    expect(manager.getUsage('orchestrator')).toBe(1234);
  });
});

describe('TokenBudgetManager.rebalance', () => {
  it('redistributes surplus from a completed agent to active agents', () => {
    const allocations = manager.allocateForTasks([makeTask('a', 5), makeTask('b', 5)]);
    const [a, b] = allocations;
    const bBefore = b!.allocatedTokens;
    const aSurplus = a!.allocatedTokens - 1000;

    // a 只用了一小部分就完成（markCompleted 内部自动触发 rebalance）
    manager.reportUsage(a!.agentId, 1000);
    manager.markCompleted(a!.agentId);

    const bAfter = manager.getTaskAllocation('b')!.allocatedTokens;
    expect(bAfter).toBe(bBefore + aSurplus);
  });

  it('is idempotent: a completed task surplus is only released once', () => {
    const allocations = manager.allocateForTasks([makeTask('a', 5), makeTask('b', 5)]);
    const [a] = allocations;

    manager.reportUsage(a!.agentId, 1000);
    manager.markCompleted(a!.agentId);
    const bAfterFirst = manager.getTaskAllocation('b')!.allocatedTokens;

    // 显式重复调用不应再次派发同一份盈余
    manager.rebalance(a!.agentId);
    manager.rebalance(a!.agentId);
    expect(manager.getTaskAllocation('b')!.allocatedTokens).toBe(bAfterFirst);
  });

  it('does not rebalance when autoRebalance is off', () => {
    manager.configure({ autoRebalance: false });
    const allocations = manager.allocateForTasks([makeTask('a', 5), makeTask('b', 5)]);
    const [a, b] = allocations;
    const bBefore = b!.allocatedTokens;

    manager.reportUsage(a!.agentId, 1000);
    manager.markCompleted(a!.agentId);
    manager.rebalance(a!.agentId);

    expect(manager.getTaskAllocation('b')!.allocatedTokens).toBe(bBefore);
  });
});

describe('TokenBudgetManager.getReport', () => {
  it('summarizes totals, spend and per-task status', () => {
    const allocations = manager.allocateForTasks([makeTask('a', 5)]);
    manager.reportUsage(allocations[0]!.agentId, 500);

    const report = manager.getReport();
    expect(report.totalBudget).toBe(100_000);
    expect(report.totalSpent).toBe(500);
  });
});
