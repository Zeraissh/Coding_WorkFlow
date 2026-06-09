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
    initialValue: modelOptions.find(o => o.value === GlobalConfig.get().model)?.value || modelOptions[0].value
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

  p.outro(color.green('Configuration saved successfully!'));
}
