import fs from 'fs';
import path from 'path';
import { builtinTools } from '../tools/builtin';
import { workflowEvents } from './events';

export interface PluginContext {
  registerTool: (toolSchema: any, executor: (args: any, agentId?: string) => Promise<string>) => void;
  on: typeof workflowEvents.on;
}

export class PluginManager {
  private pluginsDir: string;
  private loadedPlugins: string[] = [];

  constructor(baseDir: string = process.cwd()) {
    this.pluginsDir = path.join(baseDir, '.workflow', 'plugins');
  }

  async loadAll(): Promise<void> {
    if (!fs.existsSync(this.pluginsDir)) {
      try {
        fs.mkdirSync(this.pluginsDir, { recursive: true });
      } catch (e) {
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

  private async loadPlugin(filename: string) {
    const pluginPath = path.resolve(this.pluginsDir, filename);
    try {
      const fileUrl = 'file://' + pluginPath.replace(/\\/g, '/');
      const pluginModule = await import(fileUrl);

      if (typeof pluginModule.register === 'function') {
        const ctx: PluginContext = {
          registerTool: (toolSchema, executor) => {
            builtinTools.push(toolSchema as any);
            const { executeBuiltinTool } = require('../tools/builtin');
            const original = executeBuiltinTool;
            (global as any).executeBuiltinTool = async (name: string, args: any, agentId?: string) => {
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
    } catch (err: any) {
      console.error(`Failed to load plugin ${filename}:`, err.message);
    }
  }

  getLoadedPlugins(): string[] {
    return this.loadedPlugins;
  }
}
