import { describe, it, expect, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { Clarifier, ClarifyQuestion } from '../src/core/orchestrator/clarifier';

const gapResponse = (gaps: object) => '```json\n' + JSON.stringify(gaps) + '\n```';

const sampleQuestions = [
  {
    id: 'mcu',
    question: '下位机 MCU 平台选型？',
    options: [
      { label: 'ESP32', rationale: 'ESPHome 生态成熟，WiFi 集成', recommended: true },
      { label: 'STM32', rationale: '工业级实时性，Valetudo 改装常见', recommended: false },
    ],
  },
  {
    id: 'protocol',
    question: '上下位机通信协议？',
    options: [
      { label: '串口', rationale: '调试简单', recommended: false },
      { label: 'MQTT', rationale: 'Home Assistant 生态标准', recommended: true },
    ],
  },
];

function makeClarifier(responses: string[], opts: { search?: (q: string) => Promise<string>; config?: object } = {}) {
  let call = 0;
  const callLLM = vi.fn(async () => responses[Math.min(call++, responses.length - 1)] ?? '');
  const deps: any = { callLLM };
  if (opts.search) deps.searchWeb = opts.search;
  return { clarifier: new Clarifier(deps, opts.config), callLLM };
}

describe('Clarifier.assessGaps + needsClarification', () => {
  it('triggers clarification for complex multi-layer goals', async () => {
    const { clarifier } = makeClarifier([
      gapResponse({ complexityEstimate: 9, ambiguityScore: 0.8, missingDimensions: ['MCU', '协议'], multiLayer: true }),
    ]);
    const assessment = await clarifier.assessGaps('开发一款扫地机器人');
    expect(clarifier.needsClarification(assessment)).toBe(true);
  });

  it('skips clarification for simple goals', async () => {
    const { clarifier } = makeClarifier([
      gapResponse({ complexityEstimate: 2, ambiguityScore: 0.1, missingDimensions: [], multiLayer: false }),
    ]);
    const assessment = await clarifier.assessGaps('修复 README 错别字');
    expect(clarifier.needsClarification(assessment)).toBe(false);
  });

  it('skips when complexity is high but nothing is ambiguous', async () => {
    const { clarifier } = makeClarifier([
      gapResponse({ complexityEstimate: 8, ambiguityScore: 0.2, missingDimensions: ['一个维度'], multiLayer: false }),
    ]);
    const assessment = await clarifier.assessGaps('一个详尽指定的大任务');
    expect(clarifier.needsClarification(assessment)).toBe(false);
  });

  it('degrades safely on malformed LLM output', async () => {
    const { clarifier } = makeClarifier(['not json']);
    const assessment = await clarifier.assessGaps('whatever');
    expect(assessment.complexityEstimate).toBe(5);
    expect(clarifier.needsClarification(assessment)).toBe(false);
  });
});

describe('Clarifier.generateQuestions', () => {
  it('parses valid questions and feeds research into the prompt', async () => {
    const search = vi.fn(async () => JSON.stringify([{ title: 'Valetudo', description: 'cloud-free vacuum' }]));
    const { clarifier, callLLM } = makeClarifier(
      ['```json\n' + JSON.stringify(sampleQuestions) + '\n```'],
      { search }
    );

    const { questions, researchNotes } = await clarifier.generateQuestions('扫地机器人', {
      complexityEstimate: 9, ambiguityScore: 0.8, missingDimensions: ['MCU'], multiLayer: true,
    });

    expect(search).toHaveBeenCalledTimes(2);
    expect(researchNotes).toContain('Valetudo');
    expect(questions).toHaveLength(2);
    expect(questions[0]!.options.some(o => o.recommended)).toBe(true);
    // 调研结果进入了出题 prompt
    expect((callLLM.mock.calls[0] as any)[0]).toContain('Valetudo');
  });

  it('works without a search function (degraded mode)', async () => {
    const { clarifier } = makeClarifier(['```json\n' + JSON.stringify(sampleQuestions) + '\n```']);
    const { questions, researchNotes } = await clarifier.generateQuestions('goal', {
      complexityEstimate: 8, ambiguityScore: 0.9, missingDimensions: [], multiLayer: true,
    });
    expect(researchNotes).toBe('');
    expect(questions).toHaveLength(2);
  });

  it('survives search failures', async () => {
    const search = vi.fn(async () => { throw new Error('network down'); });
    const { clarifier } = makeClarifier(
      ['```json\n' + JSON.stringify(sampleQuestions) + '\n```'],
      { search }
    );
    const { questions } = await clarifier.generateQuestions('goal', {
      complexityEstimate: 8, ambiguityScore: 0.9, missingDimensions: [], multiLayer: true,
    });
    expect(questions).toHaveLength(2);
  });

  it('drops malformed questions and respects maxQuestions', async () => {
    const tooMany = [...sampleQuestions,
      { id: 'bad', question: 'only one option', options: [{ label: 'x' }] }, // <2 options → 丢弃
      { id: 'q3', question: 'ok', options: sampleQuestions[0]!.options },
      { id: 'q4', question: 'ok', options: sampleQuestions[0]!.options },
      { id: 'q5', question: 'ok', options: sampleQuestions[0]!.options },
    ];
    const { clarifier } = makeClarifier(
      ['```json\n' + JSON.stringify(tooMany) + '\n```'],
      { config: { maxQuestions: 3 } }
    );
    const { questions } = await clarifier.generateQuestions('goal', {
      complexityEstimate: 8, ambiguityScore: 0.9, missingDimensions: [], multiLayer: true,
    });
    expect(questions).toHaveLength(3);
    expect(questions.find(q => q.id === 'bad')).toBeUndefined();
  });
});

describe('Clarifier requirements doc', () => {
  it('autoAnswer picks recommended options marked as assumptions', () => {
    const { clarifier } = makeClarifier([]);
    const answers = clarifier.autoAnswer(sampleQuestions as ClarifyQuestion[]);
    expect(answers).toEqual([
      { questionId: 'mcu', choice: 'ESP32', assumed: true },
      { questionId: 'protocol', choice: 'MQTT', assumed: true },
    ]);
  });

  it('builds a doc with decision table, assumptions and research, and saves atomically', () => {
    const { clarifier } = makeClarifier([]);
    const answers = [
      { questionId: 'mcu', choice: 'ESP32', assumed: true },
      { questionId: 'protocol', choice: '串口', assumed: false },
    ];
    const doc = clarifier.buildRequirementsDoc('扫地机器人', sampleQuestions as ClarifyQuestion[], answers, '### Query: x\nValetudo');

    expect(doc).toContain('扫地机器人');
    expect(doc).toContain('| 下位机 MCU 平台选型？ | ESP32 |');
    expect(doc).toContain('未经确认的假设');
    expect(doc).toContain('ESP32**'); // 假设列表只含 assumed 项
    expect(doc).not.toContain('→ **串口**');
    expect(doc).toContain('调研引用');

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clarify-'));
    try {
      const saved = clarifier.saveRequirementsDoc(doc, tmpDir);
      expect(fs.readFileSync(saved, 'utf-8')).toBe(doc);
      expect(fs.existsSync(saved + '.tmp')).toBe(false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
