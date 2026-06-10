import { builtinTools } from '../tools/builtin';
export class ToolRetriever {
    store = null;
    initialized = false;
    constructor() {
        // VectorStore is lazily initialized to avoid loading native modules
        // (hnswlib-node, @xenova/transformers) at startup
    }
    async init() {
        if (this.initialized)
            return;
        // Dynamic import to defer native module loading
        const { VectorStore } = await import('../tools/registry/vector_store');
        this.store = new VectorStore();
        await this.store.init();
        // Register built-in tools
        for (const tool of builtinTools) {
            await this.store.addTool({
                id: `builtin_${tool.name}`,
                name: tool.name,
                description: tool.description,
                source: 'builtin',
                schema: tool.input_schema
            });
        }
        this.initialized = true;
    }
    async getRelevantTools(taskDescription) {
        await this.init();
        return this.store.searchTools(taskDescription, 3);
    }
}
//# sourceMappingURL=retriever.js.map