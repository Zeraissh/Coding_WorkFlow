import { Tool } from "@anthropic-ai/sdk/resources/messages.js";
export declare class MCPRegistry {
    private static instance;
    private clients;
    private toolsCache;
    private initialized;
    private constructor();
    static getInstance(): MCPRegistry;
    init(cwd?: string): Promise<void>;
    getGlobalTools(): Tool[];
    callTool(toolName: string, args: any): Promise<string>;
    hasTool(toolName: string): boolean;
}
//# sourceMappingURL=registry.d.ts.map