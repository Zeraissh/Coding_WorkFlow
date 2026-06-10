"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MCPClientWrapper = void 0;
const index_js_1 = require("@modelcontextprotocol/sdk/client/index.js");
const stdio_js_1 = require("@modelcontextprotocol/sdk/client/stdio.js");
const messages_js_1 = require("@anthropic-ai/sdk/resources/messages.js");
class MCPClientWrapper {
    client;
    transport;
    constructor(command, args) {
        this.transport = new stdio_js_1.StdioClientTransport({
            command,
            args
        });
        this.client = new index_js_1.Client({
            name: "dynamic-workflow-client",
            version: "1.0.0"
        }, {
            capabilities: {
                tools: {}
            }
        });
    }
    async connect() {
        await this.client.connect(this.transport);
    }
    async getTools() {
        const response = await this.client.listTools();
        return response.tools.map(tool => ({
            name: tool.name,
            description: tool.description || '',
            input_schema: tool.inputSchema
        }));
    }
    async callTool(name, args) {
        const result = await this.client.callTool({
            name,
            arguments: args
        });
        if (result.content && result.content.length > 0) {
            const textContents = result.content
                .filter((c) => c.type === 'text')
                .map((c) => c.text);
            return textContents.join('\n');
        }
        return "Tool execution returned no content.";
    }
    async disconnect() {
        await this.client.close();
    }
}
exports.MCPClientWrapper = MCPClientWrapper;
//# sourceMappingURL=client.js.map