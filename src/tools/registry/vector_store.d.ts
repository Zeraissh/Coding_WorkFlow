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
export declare function isVectorStoreAvailable(): boolean;
export declare class VectorStore {
    private dim;
    private index;
    private extractFeatures;
    private toolsMap;
    private toolsList;
    private numElements;
    private initialized;
    constructor(dim?: number);
    init(): Promise<void>;
    private getEmbedding;
    /** 简单文本哈希 → 伪向量 (降级方案，保持接口兼容) */
    private simpleHashVector;
    /** 降级模式下的余弦相似度计算 */
    private cosineSimilarity;
    /** 关键词匹配 (降级方案) */
    private keywordMatch;
    addTool(tool: ToolRecord): Promise<void>;
    searchTools(query: string, topK?: number): Promise<ToolRecord[]>;
}
//# sourceMappingURL=vector_store.d.ts.map