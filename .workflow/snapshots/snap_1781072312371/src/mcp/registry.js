import * as fs from 'fs';
import * as path from 'path';
import { MCPClientWrapper } from './client';
export class MCPRegistry {
    static instance;
    clients = new Map();
    toolsCache = new Map();
    initialized = false;
    constructor() { }
    static getInstance() {
        if (!MCPRegistry.instance) {
            MCPRegistry.instance = new MCPRegistry();
        }
        return MCPRegistry.instance;
    }
    async init(cwd = process.cwd()) {
        if (this.initialized)
            return;
        const configPath = path.join(cwd, '.workflow', 'mcp_config.json');
        if (!fs.existsSync(configPath)) {
            this.initialized = true;
            return;
        }
        try {
            const configStr = fs.readFileSync(configPath, 'utf-8');
            const config = JSON.parse(configStr);
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
        }
        catch (e) {
            console.error("[MCP] Failed to init MCP servers", e);
        }
    }
    getGlobalTools() {
        return Array.from(this.toolsCache.values()).map(t => t.tool);
    }
    async callTool(toolName, args) {
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
    hasTool(toolName) {
        return this.toolsCache.has(toolName);
    }
}
//# sourceMappingURL=registry.js.map