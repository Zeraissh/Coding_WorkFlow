import * as p from '@clack/prompts';
import color from 'chalk';
import { GlobalConfig, WorkflowConfig } from '../core/config';

export async function runConfigCLI() {
  p.intro(color.bgCyan(color.black(' Workflow LLM Configuration ')));

  const provider = await p.select({
    message: 'Select your LLM Provider:',
    options: [
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'openai', label: 'OpenAI' },
    ],
    initialValue: GlobalConfig.get().provider
  });

  if (p.isCancel(provider)) {
    p.outro('Configuration cancelled.');
    return;
  }

  let modelOptions: { value: string, label: string }[] = [];
  if (provider === 'anthropic') {
    modelOptions = [
      { value: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022' },
      { value: 'claude-3-opus-20240229', label: 'claude-3-opus' },
      { value: 'claude-3-haiku-20240307', label: 'claude-3-haiku' }
    ];
  } else if (provider === 'deepseek') {
    modelOptions = [
      { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro' },
      { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash' }
    ];
  } else {
    modelOptions = [
      { value: 'gpt-4o', label: 'gpt-4o' },
      { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
      { value: 'o1-preview', label: 'o1-preview' },
      { value: 'o3-mini', label: 'o3-mini' }
    ];
  }

  const model = await p.select({
    message: 'Select the model:',
    options: modelOptions,
    initialValue: modelOptions.find(o => o.value === GlobalConfig.get().model)?.value || modelOptions[0]?.value
  });

  if (p.isCancel(model)) return;

  let reasoningEffort = 'none';
  if (provider === 'deepseek' || String(model).startsWith('o1') || String(model).startsWith('o3')) {
    const effort = await p.select({
      message: 'Select Reasoning Effort (Thinking Mode):',
      options: [
        { value: 'none', label: 'None (Disable Thinking)' },
        { value: 'high', label: 'High (Standard Thinking)' },
        { value: 'max', label: 'Max (Maximum Thinking)' },
      ],
      initialValue: GlobalConfig.get().reasoningEffort
    });
    if (p.isCancel(effort)) return;
    reasoningEffort = effort as string;
  }

  const apiKey = await p.password({
    message: `Enter your ${provider} API Key:`,
  });

  if (p.isCancel(apiKey)) return;

  GlobalConfig.update({
    provider: provider as WorkflowConfig['provider'],
    model: model as string,
    reasoningEffort: reasoningEffort as WorkflowConfig['reasoningEffort'],
    apiKey: apiKey as string
  });

  // --- 进阶配置（可选） ---
  const advancedConfig = await p.confirm({
    message: '是否配置进阶选项（任务拆解、校验、预算等）？',
    initialValue: false,
  });

  if (!p.isCancel(advancedConfig) && advancedConfig) {
    await configureAdvanced();
  }

  p.outro(color.green('Configuration saved successfully!'));
}

async function configureAdvanced() {
  const currentConfig = GlobalConfig.get();

  // Orchestrator
  const enableSelfCheck = await p.confirm({
    message: '[Orchestrator] 是否启用任务拆解自检（LLM 二次审查拆解质量）？',
    initialValue: currentConfig.orchestratorConfig?.enableSelfCheck ?? true,
  });
  if (!p.isCancel(enableSelfCheck)) {
    const maxSubtasks = await p.text({
      message: '[Orchestrator] 最大并行子任务数？',
      initialValue: String(currentConfig.orchestratorConfig?.maxSubtasks ?? 8),
    });
    if (!p.isCancel(maxSubtasks)) {
      currentConfig.orchestratorConfig = {
        ...currentConfig.orchestratorConfig,
        enableSelfCheck,
        maxSubtasks: parseInt(maxSubtasks as string) || 8,
      };
    }
  }

  // Verifier
  const autoCheck = await p.confirm({
    message: '[Verifier] 是否启用自动化检查（Lint + 类型 + 测试）？',
    initialValue: currentConfig.verifierConfig?.autoCheck ?? true,
  });
  if (!p.isCancel(autoCheck)) {
    const semanticReview = await p.confirm({
      message: '[Verifier] 是否启用 LLM 语义审查（第二阶段，使用便宜模型）？',
      initialValue: currentConfig.verifierConfig?.semanticReview ?? true,
    });
    if (!p.isCancel(semanticReview)) {
      currentConfig.verifierConfig = {
        ...currentConfig.verifierConfig,
        autoCheck,
        semanticReview,
      };
    }
  }

  // FSLock
  const fslockEnabled = await p.confirm({
    message: '[文件锁] 是否启用文件写入锁（防止并发 Agent 写冲突）？',
    initialValue: currentConfig.fslockConfig?.enabled ?? true,
  });
  if (!p.isCancel(fslockEnabled)) {
    currentConfig.fslockConfig = {
      ...currentConfig.fslockConfig,
      enabled: fslockEnabled,
    };
  }

  // Budget
  const budgetEnabled = await p.confirm({
    message: '[Token 预算] 是否启用 Token 预算管理（控制 API 成本）？',
    initialValue: currentConfig.budgetConfig?.enabled ?? false,
  });
  if (!p.isCancel(budgetEnabled)) {
    let totalTokens = currentConfig.budgetConfig?.totalTokens ?? 500000;
    if (budgetEnabled) {
      const input = await p.text({
        message: '[Token 预算] 预算总额（token）？',
        initialValue: String(totalTokens),
      });
      if (!p.isCancel(input)) {
        totalTokens = parseInt(input as string) || 500000;
      }
    }
    currentConfig.budgetConfig = {
      ...currentConfig.budgetConfig,
      enabled: budgetEnabled,
      totalTokens,
    };
  }

  GlobalConfig.update(currentConfig);
}
