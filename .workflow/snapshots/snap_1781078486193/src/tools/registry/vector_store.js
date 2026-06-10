import { pipeline } from '@xenova/transformers';
import hnswlib from 'hnswlib-node';
export class VectorStore {
    dim;
    index;
    extractFeatures = null;
    toolsMap = new Map();
    numElements = 0;
    constructor(dim = 384) {
        this.dim = dim;
        this.index = new hnswlib.HierarchicalNSW('cosine', dim);
        this.index.initIndex(100);
    }
    async init() {
        // using all-MiniLM-L6-v2 which has 384 dimensions
        this.extractFeatures = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    async getEmbedding(text) {
        const out = await this.extractFeatures(text, { pooling: 'mean', normalize: true });
        return Array.from(out.data);
    }
    async addTool(tool) {
        const textToEmbed = `${tool.name}: ${tool.description}`;
        const embedding = await this.getEmbedding(textToEmbed);
        this.toolsMap.set(this.numElements, tool);
        this.index.addPoint(embedding, this.numElements);
        this.numElements++;
    }
    async searchTools(query, topK = 2) {
        if (this.numElements === 0)
            return [];
        const embedding = await this.getEmbedding(query);
        const result = this.index.searchKnn(embedding, Math.min(topK, this.numElements));
        return result.neighbors.map(idx => this.toolsMap.get(idx));
    }
}
//# sourceMappingURL=vector_store.js.map