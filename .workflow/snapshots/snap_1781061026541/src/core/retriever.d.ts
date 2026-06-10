import { ToolRecord } from './registry/vector_store';
export declare class ToolRetriever {
    private store;
    private initialized;
    constructor();
    init(): Promise<void>;
    getRelevantTools(taskDescription: string): Promise<ToolRecord[]>;
}
//# sourceMappingURL=retriever.d.ts.map