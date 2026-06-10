import { Tool } from "@anthropic-ai/sdk/resources/messages.js";
export declare class MCPClientWrapper {
    private client;
    private transport;
    constructor(command: string, args: string[]);
    connect(): Promise<void>;
    getTools(): Promise<Tool[]>;
    callTool(name: string, args: any): Promise<string>;
    disconnect(): Promise<void>;
}
//# sourceMappingURL=client.d.ts.map