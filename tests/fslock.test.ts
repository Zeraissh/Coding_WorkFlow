import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileLockManager } from '../src/core/fslock';

let lockManager: FileLockManager;
let tmpDir: string;

beforeEach(() => {
  lockManager = FileLockManager.getInstance();
  lockManager.reset();
  lockManager.configure({ enabled: true, timeoutMs: 30000 });
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fslock-'));
});

afterEach(() => {
  lockManager.reset();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('FileLockManager', () => {
  it('grants a free write lock immediately', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await lockManager.acquireWrite(file, 'agent-1');
    expect(lockManager.isLocked(file)).toBe(true);
    expect(lockManager.getLockInfo(file)?.ownerAgentId).toBe('agent-1');
  });

  it('blocks a second writer until the first releases', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await lockManager.acquireWrite(file, 'agent-1');

    let secondAcquired = false;
    const second = lockManager.acquireWrite(file, 'agent-2').then(() => {
      secondAcquired = true;
    });

    await new Promise(r => setTimeout(r, 20));
    expect(secondAcquired).toBe(false);

    lockManager.release(file, 'agent-1');
    await second;
    expect(secondAcquired).toBe(true);
    expect(lockManager.getLockInfo(file)?.ownerAgentId).toBe('agent-2');
  });

  it('is reentrant for the same agent', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await lockManager.acquireWrite(file, 'agent-1');
    await lockManager.acquireWrite(file, 'agent-1'); // 重入不阻塞

    lockManager.release(file, 'agent-1'); // 释放一层重入
    expect(lockManager.isLocked(file)).toBe(true);
    lockManager.release(file, 'agent-1');
    expect(lockManager.isLocked(file)).toBe(false);
  });

  it('writeFile succeeds while holding the lock and throws without it', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await lockManager.acquireWrite(file, 'agent-1');
    lockManager.writeFile(file, 'agent-1', 'hello');
    expect(fs.readFileSync(file, 'utf-8')).toBe('hello');

    expect(() => lockManager.writeFile(file, 'agent-2', 'stomp')).toThrow(/does not hold a write lock/);
  });

  it('records a conflict when multiple agents write the same file', async () => {
    const file = path.join(tmpDir, 'shared.txt');
    await lockManager.acquireWrite(file, 'agent-1');
    lockManager.release(file, 'agent-1');

    await lockManager.acquireWrite(file, 'agent-2');
    lockManager.release(file, 'agent-2');

    const conflicts = lockManager.getConflictLog();
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.agents.sort()).toEqual(['agent-1', 'agent-2']);
  });

  it('releaseAll frees every lock held by an agent and hands over queued writers', async () => {
    const fileA = path.join(tmpDir, 'a.txt');
    const fileB = path.join(tmpDir, 'b.txt');
    await lockManager.acquireWrite(fileA, 'agent-1');
    await lockManager.acquireWrite(fileB, 'agent-1');

    const waiter = lockManager.acquireWrite(fileA, 'agent-2');
    lockManager.releaseAll('agent-1');
    await waiter;

    expect(lockManager.getLockInfo(fileA)?.ownerAgentId).toBe('agent-2');
    expect(lockManager.isLocked(fileB)).toBe(false);
  });

  it('ignores release attempts from non-owners', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await lockManager.acquireWrite(file, 'agent-1');
    lockManager.release(file, 'agent-2');
    expect(lockManager.getLockInfo(file)?.ownerAgentId).toBe('agent-1');
  });

  it('does nothing when disabled', async () => {
    lockManager.configure({ enabled: false });
    const file = path.join(tmpDir, 'a.txt');
    await lockManager.acquireWrite(file, 'agent-1');
    expect(lockManager.isLocked(file)).toBe(false);
    // 禁用时 writeFile 不做锁校验
    lockManager.writeFile(file, 'anyone', 'content');
    expect(fs.readFileSync(file, 'utf-8')).toBe('content');
  });
});
