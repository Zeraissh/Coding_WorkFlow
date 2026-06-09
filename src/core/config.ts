import fs from 'fs';
import path from 'path';
import os from 'os';

export interface OrchestratorModuleConfig {
  maxSubtasks: number;
  minComplexityForSplit: number;
  enableSelfCheck: boolean;
  fewShotCategory: 'general' | 'code' | 'bugfix' | 'auto';
}

export interface VerifierModuleConfig {
  autoCheck: boolean;
  semanticReview: boolean;
  autoFix: boolean;
  reviewModel?: string;
}

export interface FSLockModuleConfig {
  enabled: boolean;
  timeoutMs: number;
}

export interface BudgetModuleConfig {
  enabled: boolean;
  totalTokens: number;
  autoRebalance: boolean;
  verifierReservePercent: number;
  thresholds: {
    warning: number;
    critical: number;
    exhaust: number;
  };
}

export interface WorkflowConfig {
  requireApproval: boolean;
  provider: 'anthropic' | 'deepseek' | 'openai';
  model: string;
  apiKey: string;
  reasoningEffort: 'none' | 'high' | 'max';
  /** Orchestrator 拆解增强配置 */
  orchestratorConfig?: Partial<OrchestratorModuleConfig>;
  /** Verifier 两阶段校验配置 */
  verifierConfig?: Partial<VerifierModuleConfig>;
  /** 文件锁配置 */
  fslockConfig?: Partial<FSLockModuleConfig>;
  /** Token 预算配置 */
  budgetConfig?: Partial<BudgetModuleConfig>;
}

const CONFIG_PATH = path.join(os.homedir(), '.workflow_config.json');

const defaultConfig: WorkflowConfig = {
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
