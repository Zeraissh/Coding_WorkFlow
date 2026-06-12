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
