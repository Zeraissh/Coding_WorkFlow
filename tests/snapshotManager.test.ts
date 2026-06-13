import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { SnapshotManager } from '../src/core/snapshotManager';

let tmpDir: string;

function write(rel: string, content: string) {
  const p = path.join(tmpDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, 'utf-8');
}
function read(rel: string): string {
  return fs.readFileSync(path.join(tmpDir, rel), 'utf-8');
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-'));
  write('src/app.ts', 'original app');
  write('tests/app.test.ts', 'original test');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('SnapshotManager', () => {
  it('createSnapshot copies src and tests into a snapshot dir', () => {
    const sm = new SnapshotManager(tmpDir);
    const id = sm.createSnapshot();

    const snapPath = path.join(tmpDir, '.workflow', 'snapshots', id);
    expect(fs.existsSync(path.join(snapPath, 'src', 'app.ts'))).toBe(true);
    expect(fs.readFileSync(path.join(snapPath, 'tests', 'app.test.ts'), 'utf-8')).toBe('original test');
  });

  it('rollback restores modified and deleted files', () => {
    const sm = new SnapshotManager(tmpDir);
    sm.createSnapshot();

    // mutate after snapshot
    write('src/app.ts', 'CORRUPTED');
    write('src/extra.ts', 'should be gone after rollback');
    fs.rmSync(path.join(tmpDir, 'tests', 'app.test.ts'));

    sm.rollback();

    expect(read('src/app.ts')).toBe('original app'); // modification reverted
    expect(read('tests/app.test.ts')).toBe('original test'); // deletion restored
    expect(fs.existsSync(path.join(tmpDir, 'src', 'extra.ts'))).toBe(false); // new file removed
  });

  it('prune removes the snapshot directory', () => {
    const sm = new SnapshotManager(tmpDir);
    const id = sm.createSnapshot();
    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'snapshots', id))).toBe(true);

    sm.prune();
    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'snapshots', id))).toBe(false);
  });

  it('rollback and prune are no-ops when no snapshot was taken', () => {
    const sm = new SnapshotManager(tmpDir);
    expect(() => sm.rollback()).not.toThrow();
    expect(() => sm.prune()).not.toThrow();
    expect(read('src/app.ts')).toBe('original app'); // untouched
  });
});
