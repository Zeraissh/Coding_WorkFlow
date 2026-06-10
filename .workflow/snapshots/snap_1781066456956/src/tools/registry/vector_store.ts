import { pipeline } from '@xenova/transformers';
import hnswlib from 'hnswlib-node';

export interface ToolRecord {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'mcp';
  mcpCommand?: string[];
  schema: any;
}

export class VectorStore {
  private index: hnswlib.HierarchicalNSW;
  private extractFeatures: any = null;
  private toolsMap: Map<number, ToolRecord> = new Map();
  private numElements = 0;

  constructor(private dim: number = 384) {
    this.index = new hnswlib.HierarchicalNSW('cosine', dim);
    this.index.initIndex(100);
  }

  async init() {
    // using all-MiniLM-L6-v2 which has 384 dimensions
    this.extractFeatures = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
  }

  async getEmbedding(text: string): Promise<number[]> {
    const out = await this.extractFeatures(text, { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }

  async addTool(tool: ToolRecord) {
    const textToEmbed = `${tool.name}: ${tool.description}`;
    const embedding = await this.getEmbedding(textToEmbed);
    
    this.toolsMap.set(this.numElements, tool);
    this.index.addPoint(embedding, this.numElements);
    this.numElements++;
  }

  async searchTools(query: string, topK: number = 2): Promise<ToolRecord[]> {
    if (this.numElements === 0) return [];
    
    const embedding = await this.getEmbedding(query);
    const result = this.index.searchKnn(embedding, Math.min(topK, this.numElements));
    
    return result.neighbors.map(idx => this.toolsMap.get(idx)!);
  }
}
