/**
 * Embedder — 共享的、惰性加载、失败即降级的文本嵌入
 *
 * 复用与 indexer 相同的本地 MiniLM 模型，但独立封装，便于知识库等模块复用。
 * 关键：模型不可用（典型：huggingface.co 不可达）时返回 null，而非抛错——
 * 调用方据此降级（如知识库回退到词法检索），与全局离线韧性一致。
 */

let _pipeline: any = null;
let _disabled = false;
let _warned = false;

/**
 * 嵌入一段文本为向量；模型不可用时返回 null（不抛错）。
 * 首次调用惰性加载模型；加载失败后永久降级（本进程内）。
 */
export async function embedText(text: string): Promise<number[] | null> {
  if (_disabled) return null;
  try {
    if (!_pipeline) {
      const transformers = await import('@xenova/transformers');
      if (process.env.HF_ENDPOINT) {
        (transformers.env as any).remoteHost = process.env.HF_ENDPOINT;
      }
      _pipeline = await transformers.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    const out = await _pipeline(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data as Float32Array);
  } catch (e: any) {
    _disabled = true;
    if (!_warned) {
      _warned = true;
      console.warn(
        `[embedder] Embedding model unavailable (${(e.message || '').slice(0, 80)}). ` +
        `Falling back to lexical search. Tip: if huggingface.co is blocked, set HF_ENDPOINT=https://hf-mirror.com`
      );
    }
    return null;
  }
}

/** 余弦相似度（向量已归一化时等价于点积，但这里不假设归一化） */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** 测试用：重置降级状态 */
export function _resetEmbedder(): void {
  _pipeline = null;
  _disabled = false;
  _warned = false;
}
