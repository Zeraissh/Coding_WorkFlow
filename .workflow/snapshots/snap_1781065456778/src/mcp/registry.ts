import * as fs from 'fs';
import * as path from 'path';
import { MCPClientWrapper } from './client';
import { Tool } from "@anthropic-ai/sdk/resources/messages.js";

interface MCPConfig {
  mcpServers: {
    [key: string]: {
      command: string;
      args: string[];
    }
  }
}

export class MCPRegistry {
  private static instance: MCPRegistry;
  private clients: Map<string, MCPClientWrapper> = new Map();
  private toolsCache: Map<string, { server: string, tool: Tool }> = new Map();
  private initialized: boolean = false;

  private constructor() {}

  public static getInstance(): MCPRegistry {
    if (!MCPRegistry.instance) {
      MCPRegistry.instance = new MCPRegistry();
    }
    return MCPRegistry.instance;
  }

  public async init(cwd: string = process.cwd()) {
    if (this.initialized) return;
    const configPath = path.join(cwd, '.workflow', 'mcp_config.json');
    if (!fs.existsSync(configPath)) {
      this.initialized = true;
      return;
    }
    try {
      const configStr = fs.readFileSync(configPath, 'utf-8');
      const config: MCPConfig = JSON.parse(configStr);
      if (config.mcpServers) {
        for (const [serverName, serverConf] of Object.entries(config.mcpServers)) {
          const client = new MCPClientWrapper(serverConf.command, serverConf.args);
          await client.connect();
          this.clients.set(serverName, client);
          const tools = await client.getTools();
          for (const tool of tools) {
            this.toolsCache.set(tool.name, { server: serverName, tool });
          }
          console.log(`[MCP] Connected to global server: ${serverName}`);
        }
      }
      this.initialized = true;
    } catch (e) {
      console.error("[MCP] Failed to init MCP servers", e);
    }
  }

  public getGlobalTools(): Tool[] {
    return Array.from(this.toolsCache.values()).map(t => t.tool);
  }

  public async callTool(toolName: string, args: any): Promise<string> {
    const info = this.toolsCache.get(toolName);
    if (!info) {
      throw new Error(`Tool ${toolName} not found in MCP registry.`);
    }
    const client = this.clients.get(info.server);
    if (!client) {
      throw new Error(`Server ${info.server} not connected.`);
    }
    return await client.callTool(toolName, args);
  }
  
  public hasTool(toolName: string): boolean {
    return this.toolsCache.has(toolName);
  }
}
