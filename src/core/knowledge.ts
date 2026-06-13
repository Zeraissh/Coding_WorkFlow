/**
 * KnowledgeStore — 项目知识库（P2.5-C.4）
 *
 * 沉淀"问用户/瞎猜"之外的第三选项：查已沉淀的决策。
 * 入库内容：需求规格（Clarify Phase 自动入库）、架构决策、调研结论、HITL 纠正。
 * Agent 通过 query_knowledge 内置工具查询。
 *
 * 检索：当前为确定性的词法评分（分块 + 词项重叠）。
 * TODO(P3): 接入 indexer.ts 的 HNSW 嵌入做语义检索（词法作为降级路径保留）。
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { embedText, cosineSimilarity } from './embedder';

export interface KnowledgeDoc {
  slug: string;
  title: string;
  source: string;
  createdAt: number;
  updatedAt: number;
}

export interface KnowledgeHit {
  docTitle: string;
  slug: string;
  chunk: string;
  score: number;
}

const CHUNK_LINES = 30;

function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'doc';
}

function tokenize(text: string): string[] {
  // 兼容中英文：英文按词、中文按双字滑窗
  const tokens: string[] = [];
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) || [];
  tokens.push(...words.filter(w => w.length >= 2));
  const cjk = text.match(/[一-鿿]+/g) || [];
  for (const segment of cjk) {
    for (let i = 0; i < segment.length - 1; i++) {
      tokens.push(segment.slice(i, i + 2));
    }
  }
  return tokens;
}

export class KnowledgeStore {
  private dir: string;

  constructor(cwd: string = process.cwd()) {
    this.dir = path.join(cwd, '.workflow', 'knowledge');
  }

  private ensureDir(): void {
    if (!fs.existsSync(this.dir)) fs.mkdirSync(this.dir, { recursive: true });
  }

  private docPath(slug: string): string {
    return path.join(this.dir, `${slug}.md`);
  }

  /** 新增/更新文档（同标题覆盖更新） */
  addDocument(title: string, content: string, source: string = 'manual'): KnowledgeDoc {
    this.ensureDir();
    const slug = slugify(title);
    const filePath = this.docPath(slug);
    const existed = fs.existsSync(filePath);

    let createdAt = Date.now();
    if (existed) {
      const old = this.readDoc(slug);
      if (old) createdAt = old.meta.createdAt;
    }

    const meta: KnowledgeDoc = { slug, title, source, createdAt, updatedAt: Date.now() };
    const fileContent = [
      '---',
      JSON.stringify(meta),
      '---',
      content,
    ].join('\n');

    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, fileContent, 'utf-8');
    fs.renameSync(tmp, filePath);
    return meta;
  }

  private readDoc(slug: string): { meta: KnowledgeDoc; body: string } | null {
    const filePath = this.docPath(slug);
    if (!fs.existsSync(filePath)) return null;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
      if (!match) return { meta: { slug, title: slug, source: 'unknown', createdAt: 0, updatedAt: 0 }, body: raw };
      return { meta: JSON.parse(match[1]!), body: match[2]! };
    } catch {
      return null;
    }
  }

  listDocuments(): KnowledgeDoc[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs.readdirSync(this.dir)
      .filter(f => f.endsWith('.md'))
      .map(f => this.readDoc(f.replace(/\.md$/, '')))
      .filter((d): d is { meta: KnowledgeDoc; body: string } => d !== null)
      .map(d => d.meta);
  }

  /** 把所有文档切成 {docTitle, slug, chunk} 列表（语义/词法检索共用） */
  private chunksOf(): { docTitle: string; slug: string; chunk: string }[] {
    if (!fs.existsSync(this.dir)) return [];
    const out: { docTitle: string; slug: string; chunk: string }[] = [];
    for (const meta of this.listDocuments()) {
      const doc = this.readDoc(meta.slug);
      if (!doc) continue;
      const lines = doc.body.split('\n');
      for (let i = 0; i < lines.length; i += CHUNK_LINES) {
        const chunk = lines.slice(i, i + CHUNK_LINES).join('\n').trim();
        if (chunk) out.push({ docTitle: meta.title, slug: meta.slug, chunk });
      }
    }
    return out;
  }

  /** 词法检索：文档分块后按查询词项重叠评分，返回 top-K 块 */
  search(query: string, topK: number = 3): KnowledgeHit[] {
    const queryTokens = new Set(tokenize(query));
    if (queryTokens.size === 0) return [];

    const hits: KnowledgeHit[] = [];
    for (const { docTitle, slug, chunk } of this.chunksOf()) {
      const chunkTokens = tokenize(chunk);
      if (chunkTokens.length === 0) continue;
      const seen = new Set<string>();
      let overlap = 0;
      for (const t of chunkTokens) {
        if (queryTokens.has(t) && !seen.has(t)) { overlap++; seen.add(t); }
      }
      if (overlap === 0) continue;
      const titleBonus = tokenize(docTitle).some(t => queryTokens.has(t)) ? 0.5 : 0;
      hits.push({ docTitle, slug, chunk, score: overlap / queryTokens.size + titleBonus });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  private embCachePath(): string {
    return path.join(this.dir, '.embeddings.json');
  }

  private loadEmbCache(): Record<string, number[]> {
    try {
      return JSON.parse(fs.readFileSync(this.embCachePath(), 'utf-8'));
    } catch {
      return {};
    }
  }

  private saveEmbCache(cache: Record<string, number[]>): void {
    try {
      const tmp = `${this.embCachePath()}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(cache), 'utf-8');
      fs.renameSync(tmp, this.embCachePath());
    } catch { /* 缓存写失败不影响检索 */ }
  }

  /**
   * 语义检索：嵌入查询与各分块做余弦排序；嵌入不可用（离线）时回退词法检索。
   * 分块嵌入缓存在 .workflow/knowledge/.embeddings.json，避免重复计算。
   * @param embed 可注入的嵌入函数（测试用），默认共享 embedder
   */
  async semanticSearch(
    query: string,
    topK: number = 3,
    embed: (text: string) => Promise<number[] | null> = embedText
  ): Promise<KnowledgeHit[]> {
    const chunks = this.chunksOf();
    if (chunks.length === 0) return [];

    const qVec = await embed(query);
    if (!qVec) return this.search(query, topK); // 嵌入不可用 → 词法兜底

    const cache = this.loadEmbCache();
    let cacheDirty = false;
    const hits: KnowledgeHit[] = [];

    for (const { docTitle, slug, chunk } of chunks) {
      const key = crypto.createHash('sha1').update(chunk).digest('hex');
      let vec = cache[key];
      if (!vec) {
        const computed = await embed(chunk);
        if (!computed) return this.search(query, topK); // 中途降级 → 词法兜底
        vec = computed;
        cache[key] = vec;
        cacheDirty = true;
      }
      hits.push({ docTitle, slug, chunk, score: cosineSimilarity(qVec, vec) });
    }

    if (cacheDirty) this.saveEmbCache(cache);
    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
