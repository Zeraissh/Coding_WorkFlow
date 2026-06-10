import fs from 'fs';
import path from 'path';
import os from 'os';
const CONFIG_PATH = path.join(os.homedir(), '.workflow_config.json');
const defaultConfig = {
    requireApproval: true,
    provider: 'anthropic',
    model: 'claude-3-5-sonnet-20241022',
    apiKey: '',
    reasoningEffort: 'none',
    orchestratorConfig: {
        maxSubtasks: 8,
        minComplexityForSplit: 2,
        enableSelfCheck: true,
        fewShotCategory: 'auto',
    },
    verifierConfig: {
        autoCheck: true,
        semanticReview: true,
        autoFix: false,
    },
    fslockConfig: {
        enabled: true,
        timeoutMs: 30000,
    },
    budgetConfig: {
        enabled: false,
        totalTokens: 500000,
        autoRebalance: true,
        verifierReservePercent: 10,
        thresholds: { warning: 0.70, critical: 0.85, exhaust: 0.95 },
    },
};
class ConfigManager {
    config;
    constructor() {
        this.config = this.loadConfig();
    }
    loadConfig() {
        if (fs.existsSync(CONFIG_PATH)) {
            try {
                const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
                return { ...defaultConfig, ...JSON.parse(data) };
            }
            catch (e) {
                return { ...defaultConfig };
            }
        }
        return { ...defaultConfig };
    }
    saveConfig() {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
    }
    get() {
        // Reload dynamically to support multi-process changes
        this.config = this.loadConfig();
        return this.config;
    }
    update(newConfig) {
        this.config = { ...this.loadConfig(), ...newConfig };
        this.saveConfig();
    }
}
export const GlobalConfig = new ConfigManager();
//# sourceMappingURL=config.js.map