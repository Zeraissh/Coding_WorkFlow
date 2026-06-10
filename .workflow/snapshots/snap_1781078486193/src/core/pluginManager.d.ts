import { workflowEvents } from './events';
export interface PluginContext {
    registerTool: (toolSchema: any, executor: (args: any, agentId?: string) => Promise<string>) => void;
    on: typeof workflowEvents.on;
}
export declare class PluginManager {
    private pluginsDir;
    private loadedPlugins;
    constructor(baseDir?: string);
    loadAll(): Promise<void>;
    private loadPlugin;
    getLoadedPlugins(): string[];
}
//# sourceMappingURL=pluginManager.d.ts.map