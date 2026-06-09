import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Tool } from "@anthropic-ai/sdk/resources/messages.js";

export class MCPClientWrapper {
  private client: Client;
  private transport: StdioClientTransport;

  constructor(command: string, args: string[]) {
    this.transport = new StdioClientTransport({
      command,
      args
    });
    this.client = new Client({
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

  async getTools(): Promise<Tool[]> {
    const response = await this.client.listTools();
    
    return response.tools.map(tool => ({
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema as any
    }));
  }

  async callTool(name: string, args: any): Promise<string> {
    const result = await this.client.callTool({
      name,
      arguments: args
    });
    
    if (result.content && result.content.length > 0) {
      const textContents = result.content
        .filter((c: any) => c.type === 'text')
        .map((c: any) => c.text);
      return textContents.join('\n');
    }
    return "Tool execution returned no content.";
  }

  async disconnect() {
    await this.client.close();
  }
}
