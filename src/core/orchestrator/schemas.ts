/**
 * LLM 结构化输出的 zod schema 校验
 *
 * 原则：对 LLM 输出保持宽容（coerce/catch 兜底），但形状必须可信——
 * 校验失败的条目被丢弃并触发上层既有的重试/兜底链路，而不是把脏数据带进 DAG。
 */

import { z } from 'zod';

/** 单个子任务（LLM 原始输出形态，宽容解析） */
export const SubtaskItemSchema = z.object({
  id: z.coerce.string().min(1),
  description: z.coerce.string().min(1),
  estimatedComplexity: z.coerce.number().catch(5).default(5),
  dependencies: z.array(z.coerce.string()).catch([]).default([]),
  isolatedFiles: z.array(z.coerce.string()).catch([]).default([]),
  sharedFiles: z.array(z.coerce.string()).catch([]).default([]),
  expectedOutput: z.coerce.string().catch('').default(''),
});

export type ParsedSubtaskItem = z.infer<typeof SubtaskItemSchema>;

/** 自检结果（缺字段一律默认空数组，保证下游可直接消费） */
export const SelfCheckSchema = z.object({
  missingDependencies: z
    .array(z.object({
      from: z.coerce.string(),
      to: z.coerce.string(),
      reason: z.coerce.string().catch('').default(''),
    }))
    .catch([])
    .default([]),
  fileConflicts: z
    .array(z.object({
      file: z.coerce.string(),
      taskA: z.coerce.string(),
      taskB: z.coerce.string(),
    }))
    .catch([])
    .default([]),
  overlyCoarse: z.array(z.coerce.string()).catch([]).default([]),
  overlyFine: z.array(z.coerce.string()).catch([]).default([]),
  warnings: z.array(z.coerce.string()).catch([]).default([]),
});

export type ParsedSelfCheck = z.infer<typeof SelfCheckSchema>;
