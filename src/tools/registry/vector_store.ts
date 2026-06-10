/**
 * VectorStore — 基于向量相似度的工具检索
 *
 * 依赖 hnswlib-node (原生模块) 和 @xenova/transformers。
 * 当原生模块不可用时 (如缺少 VC++ 编译工具)，自动降级为关键词匹配模式，
 * 不影响核心工作流执行。
 */

export interface ToolRecord {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'mcp';
  mcpCommand?: string[];
  schema: any;
}

/** 降级模式标记 — 原生模块不可用时启用 */
let _fallbackMode = false;

export function isVectorStoreAvailable(): boolean {
  return !_fallbackMode;
}

export class VectorStore {
  private index: any = null;
  private extractFeatures: any = null;
  private toolsMap: Map<number, ToolRecord> = new Map();
  private toolsList: ToolRecord[] = [];  // 降级模式下的简单列表
  private numElements = 0;
  private initialized = false;

  constructor(private dim: number = 384) {}

  async init() {
    if (this.initialized) return;

    try {
      // 动态导入 — 原生模块不可用时抛异常，自动降级
      const hnswlib = (await import('hnswlib-node')).default;
      const { pipeline } = await import('@xenova/transformers');

      this.index = new hnswlib.HierarchicalNSW('cosine', this.dim);
      this.index.initIndex(100);
      this.extractFeatures = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
      _fallbackMode = false;
    } catch (_err) {
      // 降级模式：使用简单关键词匹配
      _fallbackMode = true;
      console.warn('[VectorStore] Native modules unavailable — falling back to keyword matching. Cache Hit Rate may be lower for tool retrieval.');
    }

    this.initialized = true;
  }

  private async getEmbedding(text: string): Promise<number[]> {
    if (_fallbackMode || !this.extractFeatures) {
      // 降级模式：返回简单的文本哈希向量 (不需要原生模块)
      return this.simpleHashVector(text, this.dim);
    }
    const out = await this.extractFeatures(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }

  /** 简单文本哈希 → 伪向量 (降级方案，保持接口兼容) */
  private simpleHashVector(text: string, dim: number): number[] {
    const vec = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      const idx = (text.charCodeAt(i) * 31 + i * 7) % dim;
      vec[idx] += 1;
    }
    // 归一化
    const magnitude = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
    if (magnitude > 0) {
      for (let i = 0; i < dim; i++) vec[i] /= magnitude;
    }
    return vec;
  }

  /** 降级模式下的余弦相似度计算 */
  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0, normA = 0, normB = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) {
      const va = a[i] ?? 0;
      const vb = b[i] ?? 0;
      dot += va * vb;
      normA += va * va;
      normB += vb * vb;
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /** 关键词匹配 (降级方案) */
  private keywordMatch(query: string, tool: ToolRecord): number {
    const queryLower = query.toLowerCase();
    const nameLower = tool.name.toLowerCase();
    const descLower = tool.description.toLowerCase();

    let score = 0;
    // 名称包含查询词 → 高分
    if (queryLower.includes(nameLower) || nameLower.includes(queryLower)) {
      score += 5;
    }
    // 逐词匹配描述
    const queryWords = queryLower.split(/\s+/);
    for (const word of queryWords) {
      if (word.length < 2) continue;
      if (nameLower.includes(word)) score += 3;
      if (descLower.includes(word)) score += 1;
    }
    return score;
  }

  async addTool(tool: ToolRecord) {
    this.toolsList.push(tool);

    if (_fallbackMode) {
      // 降级模式：仅存入列表
      this.toolsMap.set(this.numElements, tool);
      this.numElements++;
      return;
    }

    const textToEmbed = `${tool.name}: ${tool.description}`;
    const embedding = await this.getEmbedding(textToEmbed);

    this.toolsMap.set(this.numElements, tool);
    this.index.addPoint(embedding, this.numElements);
    this.numElements++;
  }

  async searchTools(query: string, topK: number = 2): Promise<ToolRecord[]> {
    if (this.numElements === 0) return [];

    if (_fallbackMode) {
      // 降级关键词匹配
      const scored = this.toolsList.map(tool => ({
        tool,
        score: this.keywordMatch(query, tool),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.filter(s => s.score > 0).slice(0, topK).map(s => s.tool);
    }

    const embedding = await this.getEmbedding(query);

    // 快速路径：元素太少时直接用余弦相似度排序
    if (this.numElements <= 10) {
      const scored: { tool: ToolRecord; score: number }[] = [];
      for (let i = 0; i < this.numElements; i++) {
        const vec = this.index.getPoint(i);
        const similarity = this.cosineSimilarity(embedding, vec);
        scored.push({ tool: this.toolsMap.get(i)!, score: similarity });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, topK).map(s => s.tool);
    }

    const result = this.index.searchKnn(embedding, Math.min(topK, this.numElements));
    return result.neighbors.map((idx: number) => this.toolsMap.get(idx)!);
  }
}
