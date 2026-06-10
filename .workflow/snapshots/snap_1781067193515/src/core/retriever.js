"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ToolRetriever = void 0;
const vector_store_1 = require("./registry/vector_store");
const builtin_1 = require("./builtin");
class ToolRetriever {
    store;
    initialized = false;
    constructor() {
        this.store = new vector_store_1.VectorStore();
    }
    async init() {
        if (this.initialized)
            return;
        await this.store.init();
        // Register built-in tools
        for (const tool of builtin_1.builtinTools) {
            await this.store.addTool({
                id: `builtin_${tool.name}`,
                name: tool.name,
                description: tool.description,
                source: 'builtin',
                schema: tool.input_schema
            });
        }
        // Register dummy MCP servers
        await this.store.addTool({
            id: `mcp_sqlite`,
            name: `database_operations`,
            description: `Run read-only SQL queries on local SQLite database. Useful for data analysis.`,
            source: 'mcp',
            mcpCommand: ['npx', '-y', '@modelcontextprotocol/server-sqlite', '--db', 'test.db'],
            schema: { type: 'object' }
        });
        this.initialized = true;
    }
    async getRelevantTools(taskDescription) {
        await this.init();
        return this.store.searchTools(taskDescription, 3);
    }
}
exports.ToolRetriever = ToolRetriever;
//# sourceMappingURL=retriever.js.map