import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ProjectIndexer } from '../src/core/indexer';

// Under VITEST the shared embedder (embedText) returns null without loading the
// native model, so ProjectIndexer should degrade to a no-op RAG cleanly — this
// verifies the indexer now goes through the shared embedder, not its own pipeline.

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'indexer-'));
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'src', 'a.ts'), 'export function hello() { return 1; }\n', 'utf-8');
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('ProjectIndexer — shared embedder + graceful degrade', () => {
  it('disables itself (no crash, no native model load) when embeddings are unavailable', async () => {
    const indexer = new ProjectIndexer(tmpDir);
    await expect(indexer.scanAndIndex()).resolves.toBeUndefined();
    // no HNSW index file written when disabled
    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'index', 'hnsw.bin'))).toBe(false);
  });

  it('search returns [] in degraded mode instead of throwing', async () => {
    const indexer = new ProjectIndexer(tmpDir);
    await expect(indexer.search('hello function')).resolves.toEqual([]);
  });
});
