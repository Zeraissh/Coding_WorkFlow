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

  /** 词法检索：文档分块后按查询词项重叠评分，返回 top-K 块 */
  search(query: string, topK: number = 3): KnowledgeHit[] {
    const queryTokens = new Set(tokenize(query));
    if (queryTokens.size === 0 || !fs.existsSync(this.dir)) return [];

    const hits: KnowledgeHit[] = [];
    for (const meta of this.listDocuments()) {
      const doc = this.readDoc(meta.slug);
      if (!doc) continue;

      const lines = doc.body.split('\n');
      for (let i = 0; i < lines.length; i += CHUNK_LINES) {
        const chunk = lines.slice(i, i + CHUNK_LINES).join('\n').trim();
        if (!chunk) continue;

        const chunkTokens = tokenize(chunk);
        if (chunkTokens.length === 0) continue;
        let overlap = 0;
        const seen = new Set<string>();
        for (const t of chunkTokens) {
          if (queryTokens.has(t) && !seen.has(t)) {
            overlap++;
            seen.add(t);
          }
        }
        if (overlap === 0) continue;

        // 标题命中加权
        const titleBonus = tokenize(meta.title).some(t => queryTokens.has(t)) ? 0.5 : 0;
        hits.push({
          docTitle: meta.title,
          slug: meta.slug,
          chunk,
          score: overlap / queryTokens.size + titleBonus,
        });
      }
    }

    return hits.sort((a, b) => b.score - a.score).slice(0, topK);
  }
}
