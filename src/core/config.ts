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

export interface ClarifierModuleConfig {
  enabled: boolean;
  /** 自动采用推荐项（无人值守），不阻塞等待用户 */
  auto: boolean;
  complexityThreshold: number;
  maxQuestions: number;
  enableResearch: boolean;
}

export interface AgentModuleConfig {
  /** 单个 Agent 的最大工具调用次数 */
  maxToolCalls: number;
  /** 同批次并行 Agent 池大小 */
  parallelPoolSize: number;
}

export interface FocusModuleConfig {
  enabled: boolean;
  /** 同签名工具调用达到该次数判定为循环 */
  repeatThreshold: number;
  /** 只读调用达到该次数且无写入判定为空转 */
  idleCallThreshold: number;
}

export interface WorkflowConfig {
  requireApproval: boolean;
  provider: 'anthropic' | 'deepseek' | 'openai';
  model: string;
  apiKey: string;
  reasoningEffort: 'none' | 'high' | 'max';
  /** Orchestrator 拆解增强配置 */
  orchestratorConfig?: Partial<OrchestratorModuleConfig>;
  /** Agent 执行配置 */
  agentConfig?: Partial<AgentModuleConfig>;
  /** 需求澄清阶段配置 */
  clarifyConfig?: Partial<ClarifierModuleConfig>;
  /** 专注度监控配置 */
  focusConfig?: Partial<FocusModuleConfig>;
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
  model: 'claude-sonnet-4-6',
  apiKey: '',
  reasoningEffort: 'none',
  orchestratorConfig: {
    maxSubtasks: 8,
    minComplexityForSplit: 2,
    enableSelfCheck: true,
    fewShotCategory: 'auto',
  },
  agentConfig: {
    maxToolCalls: 25,
    parallelPoolSize: 5,
  },
  clarifyConfig: {
    enabled: true,
    auto: false,
    complexityThreshold: 7,
    maxQuestions: 4,
    enableResearch: true,
  },
  focusConfig: {
    enabled: true,
    repeatThreshold: 3,
    idleCallThreshold: 12,
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
