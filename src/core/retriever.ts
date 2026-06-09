import { VectorStore, ToolRecord } from '../tools/registry/vector_store';
import { builtinTools } from '../tools/builtin';

export class ToolRetriever {
  private store: VectorStore;
  private initialized = false;

  constructor() {
    this.store = new VectorStore();
  }

  async init() {
    if (this.initialized) return;
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

  async getRelevantTools(taskDescription: string): Promise<ToolRecord[]> {
    await this.init();
    return this.store.searchTools(taskDescription, 3);
  }
}
