export interface ToolRecord {
    id: string;
    name: string;
    description: string;
    source: 'builtin' | 'mcp';
    mcpCommand?: string[];
    schema: any;
}
export declare class VectorStore {
    private dim;
    private index;
    private extractFeatures;
    private toolsMap;
    private numElements;
    constructor(dim?: number);
    init(): Promise<void>;
    getEmbedding(text: string): Promise<number[]>;
    addTool(tool: ToolRecord): Promise<void>;
    searchTools(query: string, topK?: number): Promise<ToolRecord[]>;
}
//# sourceMappingURL=vector_store.d.ts.map