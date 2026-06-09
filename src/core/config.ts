import fs from 'fs';
import path from 'path';
import os from 'os';

export interface WorkflowConfig {
  requireApproval: boolean;
  provider: 'anthropic' | 'deepseek' | 'openai';
  model: string;
  apiKey: string;
  reasoningEffort: 'none' | 'high' | 'max';
}

const CONFIG_PATH = path.join(os.homedir(), '.workflow_config.json');

const defaultConfig: WorkflowConfig = {
  requireApproval: true,
  provider: 'anthropic',
  model: 'claude-3-5-sonnet-20241022',
  apiKey: '',
  reasoningEffort: 'none'
};

class ConfigManager {
  private config: WorkflowConfig;

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): WorkflowConfig {
    if (fs.existsSync(CONFIG_PATH)) {
      try {
        const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
        return { ...defaultConfig, ...JSON.parse(data) };
      } catch (e) {
        return { ...defaultConfig };
      }
    }
    return { ...defaultConfig };
  }

  private saveConfig() {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  get(): WorkflowConfig {
    // Reload dynamically to support multi-process changes
    this.config = this.loadConfig();
    return this.config;
  }

  update(newConfig: Partial<WorkflowConfig>) {
    this.config = { ...this.loadConfig(), ...newConfig };
    this.saveConfig();
  }
}

export const GlobalConfig = new ConfigManager();
