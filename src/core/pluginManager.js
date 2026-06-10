import fs from 'fs';
import path from 'path';
import { builtinTools } from '../tools/builtin';
import { workflowEvents } from './events';
export class PluginManager {
    pluginsDir;
    loadedPlugins = [];
    constructor(baseDir = process.cwd()) {
        this.pluginsDir = path.join(baseDir, '.workflow', 'plugins');
    }
    async loadAll() {
        if (!fs.existsSync(this.pluginsDir)) {
            try {
                fs.mkdirSync(this.pluginsDir, { recursive: true });
            }
            catch (e) {
                return;
            }
        }
        const files = fs.readdirSync(this.pluginsDir);
        for (const file of files) {
            if (file.endsWith('.js') || file.endsWith('.mjs')) {
                await this.loadPlugin(file);
            }
        }
    }
    async loadPlugin(filename) {
        const pluginPath = path.resolve(this.pluginsDir, filename);
        try {
            const fileUrl = 'file://' + pluginPath.replace(/\\/g, '/');
            const pluginModule = await import(fileUrl);
            if (typeof pluginModule.register === 'function') {
                const ctx = {
                    registerTool: (toolSchema, executor) => {
                        builtinTools.push(toolSchema);
                        const { executeBuiltinTool } = require('../tools/builtin');
                        const original = executeBuiltinTool;
                        global.executeBuiltinTool = async (name, args, agentId) => {
                            if (name === toolSchema.name) {
                                return executor(args, agentId);
                            }
                            return original(name, args, agentId);
                        };
                    },
                    on: workflowEvents.on.bind(workflowEvents),
                };
                await pluginModule.register(ctx);
                this.loadedPlugins.push(filename);
            }
        }
        catch (err) {
            console.error(`Failed to load plugin ${filename}:`, err.message);
        }
    }
    getLoadedPlugins() {
        return this.loadedPlugins;
    }
}
//# sourceMappingURL=pluginManager.js.map