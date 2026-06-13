import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { KnowledgeStore } from '../src/core/knowledge';

let tmpDir: string;
let store: KnowledgeStore;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-'));
  store = new KnowledgeStore(tmpDir);
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe('KnowledgeStore — documents', () => {
  it('adds and lists documents with metadata', () => {
    store.addDocument('MCU 选型决策', '选择 ESP32，因为 ESPHome 生态成熟。', 'clarify-phase');
    const docs = store.listDocuments();
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ title: 'MCU 选型决策', source: 'clarify-phase' });
  });

  it('updates a document with the same title instead of duplicating', () => {
    const first = store.addDocument('架构决策', 'v1 内容');
    const second = store.addDocument('架构决策', 'v2 内容');
    expect(store.listDocuments()).toHaveLength(1);
    expect(second.createdAt).toBe(first.createdAt);
    expect(store.search('v2')[0]!.chunk).toContain('v2 内容');
  });

  it('writes atomically (no .tmp leftovers)', () => {
    store.addDocument('doc', 'content');
    const files = fs.readdirSync(path.join(tmpDir, '.workflow', 'knowledge'));
    expect(files.some(f => f.endsWith('.tmp'))).toBe(false);
  });
});

describe('KnowledgeStore — search', () => {
  beforeEach(() => {
    store.addDocument('通信协议决策', '上下位机之间使用 MQTT 协议，参考 Home Assistant 生态。串口仅用于烧录调试。');
    store.addDocument('MCU platform decision', 'The chosen MCU platform is ESP32 because of the mature ESPHome ecosystem and integrated WiFi.');
    store.addDocument('范围边界', '本期只做固件与上位机界面，不含移动端 App。');
  });

  it('finds English content by keyword', () => {
    const hits = store.search('which MCU platform was chosen');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.docTitle).toBe('MCU platform decision');
    expect(hits[0]!.chunk).toContain('ESP32');
  });

  it('finds Chinese content via bigram matching', () => {
    const hits = store.search('通信协议用什么');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.chunk).toContain('MQTT');
  });

  it('returns empty for unrelated queries', () => {
    expect(store.search('quantum blockchain telescope')).toHaveLength(0);
  });

  it('respects topK', () => {
    expect(store.search('决策 协议 范围 固件', 2).length).toBeLessThanOrEqual(2);
  });

  it('returns empty when the store has no documents', () => {
    const empty = new KnowledgeStore(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-empty-')));
    expect(empty.search('anything')).toHaveLength(0);
  });
});

describe('KnowledgeStore — semantic search', () => {
  // deterministic fake embedding: 2 dims = [cat-ness, car-ness]
  const fakeEmbed = async (text: string): Promise<number[]> => {
    const t = text.toLowerCase();
    return [
      /cat|feline|kitten|pet/.test(t) ? 1 : 0,
      /car|engine|vehicle|wheel/.test(t) ? 1 : 0,
    ];
  };

  beforeEach(() => {
    store.addDocument('Feline facts', 'Cats are feline pets. A kitten is a young cat.');
    store.addDocument('Auto facts', 'Cars have engines and wheels. A vehicle moves.');
  });

  it('ranks the semantically closest chunk first', async () => {
    const hits = await store.semanticSearch('information about a feline companion', 1, fakeEmbed);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.docTitle).toBe('Feline facts');
  });

  it('falls back to lexical search when embeddings are unavailable', async () => {
    const nullEmbed = async () => null;
    const hits = await store.semanticSearch('engines and wheels', 3, nullEmbed);
    // lexical match should still find the auto doc
    expect(hits.some(h => h.docTitle === 'Auto facts')).toBe(true);
  });

  it('caches chunk embeddings so repeated searches do not re-embed chunks', async () => {
    let calls = 0;
    const countingEmbed = async (text: string) => { calls++; return fakeEmbed(text); };

    await store.semanticSearch('feline', 3, countingEmbed);
    const afterFirst = calls; // query + N chunks
    await store.semanticSearch('feline', 3, countingEmbed);
    const secondRoundCalls = calls - afterFirst;

    expect(fs.existsSync(path.join(tmpDir, '.workflow', 'knowledge', '.embeddings.json'))).toBe(true);
    expect(secondRoundCalls).toBe(1); // only the query is embedded; chunks come from cache
  });

  it('returns empty for an empty knowledge base', async () => {
    const empty = new KnowledgeStore(fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sem-empty-')));
    expect(await empty.semanticSearch('anything', 3, fakeEmbed)).toHaveLength(0);
  });
});
