import * as fs from 'fs';
import * as path from 'path';
import { workflowEvents } from './events';

export interface CodeChunk {
  file: string;
  content: string;
  startLine: number;
}

export class ProjectIndexer {
  private index: any = null;
  private extractFeatures: any = null;
  private chunksMap: Map<number, CodeChunk> = new Map();
  private numElements = 0;
  private indexPath: string;
  private metadataPath: string;
  private initialized = false;

  constructor(private cwd: string = process.cwd(), private dim: number = 384) {
    const workflowDir = path.join(cwd, '.workflow', 'index');
    if (!fs.existsSync(workflowDir)) {
      fs.mkdirSync(workflowDir, { recursive: true });
    }
    this.indexPath = path.join(workflowDir, 'hnsw.bin');
    this.metadataPath = path.join(workflowDir, 'metadata.json');
  }

  async init() {
    if (this.initialized) return;

    // 动态导入以避免原生模块急切加载导致的崩溃
    const { pipeline } = await import('@xenova/transformers');
    const hnswlib = (await import('hnswlib-node')).default;

    this.index = new hnswlib.HierarchicalNSW('cosine', this.dim);
    this.extractFeatures = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    
    if (fs.existsSync(this.indexPath) && fs.existsSync(this.metadataPath)) {
      try {
        const metadata = JSON.parse(fs.readFileSync(this.metadataPath, 'utf-8'));
        this.numElements = metadata.numElements;
        this.chunksMap = new Map(metadata.chunks.map((c: any) => [c.id, c.chunk]));
        this.index.readIndexSync(this.indexPath);
      } catch (e) {
        // 如果损坏，重新初始化
        this.index.initIndex(10000);
        this.numElements = 0;
      }
    } else {
      this.index.initIndex(10000);
    }

    this.initialized = true;
  }

  async getEmbedding(text: string): Promise<number[]> {
    const out = await this.extractFeatures(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }

  async scanAndIndex() {
    await this.init();
    if (this.numElements > 0) return; // 已经建过索引
    
    workflowEvents.emit('log', { taskId: 'orchestrator', message: 'Building local code index for RAG (this may take a moment)...' });

    const exts = ['.ts', '.js', '.py', '.c', '.cpp', '.h', '.java', '.go', '.cs'];
    const files = this.walkDir(this.cwd, exts);
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        
        // 简易按块分割 (每 50 行一块)
        for (let i = 0; i < lines.length; i += 50) {
          const chunkLines = lines.slice(i, i + 50);
          const chunkContent = chunkLines.join('\n');
          if (chunkContent.trim().length < 20) continue;
          
          const embedding = await this.getEmbedding(chunkContent);
          this.chunksMap.set(this.numElements, {
            file: path.relative(this.cwd, file).replace(/\\/g, '/'),
            content: chunkContent,
            startLine: i + 1
          });
          this.index.addPoint(embedding, this.numElements);
          this.numElements++;
        }
      } catch (e) {
        // ignore read errors
      }
    }
    
    // 保存
    if (this.numElements > 0) {
      this.index.writeIndexSync(this.indexPath);
      const chunksArray = Array.from(this.chunksMap.entries()).map(([id, chunk]) => ({ id, chunk }));
      fs.writeFileSync(this.metadataPath, JSON.stringify({ numElements: this.numElements, chunks: chunksArray }));
      workflowEvents.emit('log', { taskId: 'orchestrator', message: `Indexed ${this.numElements} code chunks successfully.` });
    }
  }

  async search(query: string, topK: number = 3): Promise<CodeChunk[]> {
    await this.init();
    if (this.numElements === 0) return [];
    
    const embedding = await this.getEmbedding(query);
    const result = this.index.searchKnn(embedding, Math.min(topK, this.numElements));
    
    return result.neighbors.map((idx: number) => this.chunksMap.get(idx)!);
  }

  private walkDir(dir: string, exts: string[]): string[] {
    let results: string[] = [];
    let list: string[] = [];
    try {
      list = fs.readdirSync(dir);
    } catch {
      return results;
    }

    for (const file of list) {
      if (['node_modules', '.git', 'dist', 'build', '.workflow'].includes(file)) continue;
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
          results = results.concat(this.walkDir(fullPath, exts));
        } else {
          if (exts.includes(path.extname(fullPath))) {
            results.push(fullPath);
          }
        }
      } catch (e: any) {
        console.warn(`[indexer] Skipping unreadable path ${fullPath}: ${e.message}`);
      }
    }
    return results;
  }
}
