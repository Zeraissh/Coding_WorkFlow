export interface CodeChunk {
    file: string;
    content: string;
    startLine: number;
}
export declare class ProjectIndexer {
    private cwd;
    private dim;
    private index;
    private extractFeatures;
    private chunksMap;
    private numElements;
    private indexPath;
    private metadataPath;
    private initialized;
    constructor(cwd?: string, dim?: number);
    init(): Promise<void>;
    getEmbedding(text: string): Promise<number[]>;
    scanAndIndex(): Promise<void>;
    search(query: string, topK?: number): Promise<CodeChunk[]>;
    private walkDir;
}
//# sourceMappingURL=indexer.d.ts.map