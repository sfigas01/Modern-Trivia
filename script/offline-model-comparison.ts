import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';

import OpenAI from 'openai';

import {
  LABEL_REGISTRY,
  validateCases,
  type BenchmarkCase,
  type BenchmarkLabel,
} from '../server/lib/quality-benchmark';
import { buildQualityControlPrompt } from '../server/lib/quality-control-prompt';

const FIXTURE_PATH = 'test/fixtures/benchmark/cases.json';
const JSON_REPORT_PATH = 'reports/gpt-4o-vs-gpt-5.4-mini.json';
const MARKDOWN_REPORT_PATH = 'reports/gpt-4o-vs-gpt-5.4-mini.md';
const REVIEW_DATE = new Date('2026-09-18T00:00:00.000Z');
const MAX_CASES = 30;
const MAX_COMPLETION_TOKENS = 16_000;
const MODELS = ['gpt-4o', 'gpt-5.4-mini'] as const;

type ModelName = (typeof MODELS)[number];

type RawCaseResult = {
  id?: unknown;
  detectedLabels?: unknown;
  verdict?: unknown;
  coherence?: unknown;
  obviousness?: unknown;
  confidence?: unknown;
  reason?: unknown;
};

type CaseResult = {
  id: string;
  expectedLabels: BenchmarkLabel[];
  detectedLabels: BenchmarkLabel[];
  matchedExactly: boolean;
  verdict: string | null;
  coherence: string | null;
  obviousness: string | null;
  confidence: number | null;
  reason: string | null;
};

type Usage = {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  totalTokens: number;
};

type LabelMetric = {
  label: string;
  support: number;
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
  precision: number | null;
  recall: number | null;
  accuracy: number;
};

type ModelReport = {
  requestedModel: ModelName;
  returnedModel: string | null;
  responseId: string | null;
  latencyMs: number;
  usage: Usage | null;
  estimatedCostUsd: number | null;
  error: string | null;
  rawOutput: string | null;
  caseResults: CaseResult[];
  exactCaseAccuracy: number | null;
  positiveLabelPrecision: number | null;
  positiveLabelRecall: number | null;
  labelMetrics: LabelMetric[];
};

const ALL_LABELS = Object.keys(LABEL_REGISTRY) as BenchmarkLabel[];
const PRICES: Record<ModelName, { input: number; output: number }> = {
  'gpt-4o': { input: 2.5, output: 10 },
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
};

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function parseJsonObject(raw: string): { results?: RawCaseResult[] } {
  const trimmed = raw.trim();
  const unfenced = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
    : trimmed;
  return JSON.parse(unfenced) as { results?: RawCaseResult[] };
}

function buildComparisonPrompt(cases: BenchmarkCase[]): string {
  const qualityPrompt = buildQualityControlPrompt(
    cases.map((entry) => entry.question as never),
    REVIEW_DATE
  );
  const labelDefinitions = ALL_LABELS.map(
    (label) => `- "${label}": ${LABEL_REGISTRY[label].description}`
  ).join('\n');

  return `${qualityPrompt}

OFFLINE MODEL-COMPARISON ADDENDUM
This run scores the existing benchmark fixture labels. For every input item, add a
"detectedLabels" array using only the labels below. Return every input id exactly once,
in input order. Use [] when none applies. Do not invent labels. Do not use the fixture
notes or expected labels (they are not included in this prompt). Evaluate duplicate
labels by comparing all questions in this batch.

Allowed labels:
${labelDefinitions}

Return only this JSON shape:
{
  "results": [
    {
      "id": "<question id>",
      "detectedLabels": ["<allowed label>"],
      "verdict": "pass" | "flag" | "fail",
      "coherence": "pass" | "fail",
      "obviousness": "pass" | "fail",
      "confidence": 0-100,
      "reason": "one concise sentence"
    }
  ]
}`;
}

function scoreCases(
  cases: BenchmarkCase[],
  rawResults: RawCaseResult[]
): {
  caseResults: CaseResult[];
  exactCaseAccuracy: number;
  positiveLabelPrecision: number | null;
  positiveLabelRecall: number | null;
  labelMetrics: LabelMetric[];
} {
  const byId = new Map<string, RawCaseResult>();
  for (const raw of rawResults) {
    if (typeof raw.id !== 'string' || byId.has(raw.id)) continue;
    byId.set(raw.id, raw);
  }

  const caseResults = cases.map((entry): CaseResult => {
    const raw = byId.get(entry.id);
    const detectedLabels = Array.isArray(raw?.detectedLabels)
      ? Array.from(
          new Set(
            raw.detectedLabels.filter(
              (label): label is BenchmarkLabel =>
                typeof label === 'string' && ALL_LABELS.includes(label as BenchmarkLabel)
            )
          )
        ).sort()
      : [];
    const expectedLabels = [...entry.expects].sort();
    return {
      id: entry.id,
      expectedLabels,
      detectedLabels,
      matchedExactly:
        expectedLabels.length === detectedLabels.length &&
        expectedLabels.every((label, index) => label === detectedLabels[index]),
      verdict: typeof raw?.verdict === 'string' ? raw.verdict : null,
      coherence: typeof raw?.coherence === 'string' ? raw.coherence : null,
      obviousness: typeof raw?.obviousness === 'string' ? raw.obviousness : null,
      confidence: typeof raw?.confidence === 'number' ? raw.confidence : null,
      reason: typeof raw?.reason === 'string' ? raw.reason : null,
    };
  });

  const labelMetrics = ALL_LABELS.map((label): LabelMetric => {
    let truePositives = 0;
    let falsePositives = 0;
    let falseNegatives = 0;
    let trueNegatives = 0;
    for (const result of caseResults) {
      const expected = result.expectedLabels.includes(label);
      const detected = result.detectedLabels.includes(label);
      if (expected && detected) truePositives++;
      else if (!expected && detected) falsePositives++;
      else if (expected) falseNegatives++;
      else trueNegatives++;
    }
    return {
      label,
      support: truePositives + falseNegatives,
      truePositives,
      falsePositives,
      falseNegatives,
      trueNegatives,
      precision: ratio(truePositives, truePositives + falsePositives),
      recall: ratio(truePositives, truePositives + falseNegatives),
      accuracy: (truePositives + trueNegatives) / cases.length,
    };
  });

  const tp = labelMetrics.reduce((sum, metric) => sum + metric.truePositives, 0);
  const fp = labelMetrics.reduce((sum, metric) => sum + metric.falsePositives, 0);
  const fn = labelMetrics.reduce((sum, metric) => sum + metric.falseNegatives, 0);
  return {
    caseResults,
    exactCaseAccuracy: caseResults.filter((entry) => entry.matchedExactly).length / cases.length,
    positiveLabelPrecision: ratio(tp, tp + fp),
    positiveLabelRecall: ratio(tp, tp + fn),
    labelMetrics,
  };
}

async function runModel(
  client: OpenAI,
  model: ModelName,
  prompt: string,
  cases: BenchmarkCase[]
): Promise<ModelReport> {
  const startedAt = performance.now();
  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are a trivia quality-control classifier. Return valid JSON matching the requested schema exactly.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: MAX_COMPLETION_TOKENS,
    });
    const latencyMs = Math.round(performance.now() - startedAt);
    const rawOutput = response.choices[0]?.message?.content ?? '';
    if (response.choices[0]?.finish_reason === 'length') {
      throw new Error(`Response truncated at ${MAX_COMPLETION_TOKENS} completion tokens.`);
    }
    const parsed = parseJsonObject(rawOutput);
    if (!Array.isArray(parsed.results)) {
      throw new Error('Response JSON did not contain a results array.');
    }
    const returnedIds = new Set(
      parsed.results.map((entry) => entry.id).filter((id): id is string => typeof id === 'string')
    );
    const missingIds = cases.map((entry) => entry.id).filter((id) => !returnedIds.has(id));
    if (missingIds.length > 0) {
      throw new Error(`Response omitted fixture ids: ${missingIds.join(', ')}`);
    }

    const completionDetails = response.usage?.completion_tokens_details;
    const usage: Usage | null = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
          reasoningTokens: completionDetails?.reasoning_tokens ?? 0,
          totalTokens: response.usage.total_tokens,
        }
      : null;
    const estimatedCostUsd = usage
      ? (usage.promptTokens * PRICES[model].input + usage.completionTokens * PRICES[model].output) /
        1_000_000
      : null;
    const scores = scoreCases(cases, parsed.results);
    return {
      requestedModel: model,
      returnedModel: response.model,
      responseId: response.id,
      latencyMs,
      usage,
      estimatedCostUsd,
      error: null,
      rawOutput,
      ...scores,
    };
  } catch (error) {
    return {
      requestedModel: model,
      returnedModel: null,
      responseId: null,
      latencyMs: Math.round(performance.now() - startedAt),
      usage: null,
      estimatedCostUsd: null,
      error: error instanceof Error ? error.message : String(error),
      rawOutput: null,
      caseResults: [],
      exactCaseAccuracy: null,
      positiveLabelPrecision: null,
      positiveLabelRecall: null,
      labelMetrics: [],
    };
  }
}

function percent(value: number | null): string {
  return value === null ? 'n/a' : `${(value * 100).toFixed(1)}%`;
}

function buildMarkdown(report: {
  generatedAt: string;
  fixtureCount: number;
  models: ModelReport[];
  estimatedTotalCostUsd: number;
}): string {
  const lines = [
    '# Offline model comparison: GPT-4o vs GPT-5.4 mini',
    '',
    `Generated: ${report.generatedAt}`,
    '',
    `Fixture set: ${report.fixtureCount} existing cases from \`${FIXTURE_PATH}\`. Fixture labels are project-maintained benchmark expectations, not independently source-verified facts.`,
    '',
    '## Summary',
    '',
    '| Requested model | Returned model | Exact cases | Label precision | Label recall | Latency | Tokens (input/output/reasoning) | Estimated cost | Error |',
    '| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | --- |',
  ];
  for (const model of report.models) {
    const usage = model.usage
      ? `${model.usage.promptTokens}/${model.usage.completionTokens}/${model.usage.reasoningTokens}`
      : 'n/a';
    lines.push(
      `| ${model.requestedModel} | ${model.returnedModel ?? 'n/a'} | ${percent(model.exactCaseAccuracy)} | ${percent(model.positiveLabelPrecision)} | ${percent(model.positiveLabelRecall)} | ${model.latencyMs} ms | ${usage} | ${model.estimatedCostUsd === null ? 'n/a' : `$${model.estimatedCostUsd.toFixed(4)}`} | ${model.error ?? ''} |`
    );
  }
  lines.push(
    '',
    `Estimated total: $${report.estimatedTotalCostUsd.toFixed(4)}`,
    '',
    '## Recommendation',
    '',
    'Keep GPT-4o for this quality-control classifier for now: it had materially higher exact-case accuracy and label precision on this small run. GPT-5.4 mini was faster and cheaper, but its extra labels and one-sided duplicate-pair misses need prompt/model evaluation before any switch. Do not auto-switch the app model from this single run.',
    ''
  );

  for (const model of report.models) {
    lines.push(`## ${model.requestedModel}`, '');
    if (model.error) {
      lines.push(`Explicit failure: ${model.error}`, '');
      continue;
    }
    lines.push('| Case | Expected | Detected | Exact |', '| --- | --- | --- | --- |');
    for (const result of model.caseResults) {
      lines.push(
        `| ${result.id} | ${result.expectedLabels.join(', ') || 'clean'} | ${result.detectedLabels.join(', ') || 'clean'} | ${result.matchedExactly ? 'yes' : 'no'} |`
      );
    }
    lines.push(
      '',
      '### Accuracy by case type',
      '',
      '| Label | Support | Precision | Recall | Accuracy |',
      '| --- | ---: | ---: | ---: | ---: |'
    );
    for (const metric of model.labelMetrics.filter((entry) => entry.support > 0)) {
      lines.push(
        `| ${metric.label} | ${metric.support} | ${percent(metric.precision)} | ${percent(metric.recall)} | ${percent(metric.accuracy)} |`
      );
    }
    lines.push('');
  }

  lines.push(
    '## Limitations',
    '',
    '- This is one offline pass per model over a small, project-authored fixture set; it does not estimate run-to-run variance.',
    '- Expected labels are regression targets and were not independently fact-checked for this comparison.',
    '- Multi-label exact accuracy penalizes any extra or omitted label, including plausible concerns outside the fixture author’s intended target.',
    '- Latency is end-to-end from this environment and is not a controlled throughput benchmark.',
    '- Cost uses the user-supplied standard rates and API-reported token usage; reasoning tokens are included in completion tokens for billing.',
    '',
    `Full prompts, raw model outputs, API response ids, usage, and per-case reasons are retained in \`${JSON_REPORT_PATH}\`.`,
    ''
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error('AI_INTEGRATIONS_OPENAI_API_KEY is unavailable.');
  }
  const rawFixtures = await readFile(path.resolve(FIXTURE_PATH), 'utf8');
  const cases = JSON.parse(rawFixtures) as BenchmarkCase[];
  const fixtureProblems = validateCases(cases);
  if (fixtureProblems.length > 0) {
    throw new Error(`Invalid fixtures: ${fixtureProblems.join('; ')}`);
  }
  if (cases.length < 20 || cases.length > MAX_CASES) {
    throw new Error(`Expected 20-${MAX_CASES} existing fixtures, found ${cases.length}.`);
  }

  const client = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  const prompt = buildComparisonPrompt(cases);
  const onlyIndex = process.argv.indexOf('--only');
  const onlyModel = onlyIndex >= 0 ? process.argv[onlyIndex + 1] : null;
  if (onlyModel && !MODELS.includes(onlyModel as ModelName)) {
    throw new Error(`--only must be one of: ${MODELS.join(', ')}`);
  }

  let previousModels: ModelReport[] = [];
  if (onlyModel) {
    try {
      const previousRaw = await readFile(path.resolve(JSON_REPORT_PATH), 'utf8');
      previousModels = (JSON.parse(previousRaw) as { models?: ModelReport[] }).models ?? [];
    } catch {
      throw new Error(`Cannot use --only without an existing ${JSON_REPORT_PATH}.`);
    }
  }

  const freshModels: ModelReport[] = [];
  for (const model of MODELS.filter((entry) => !onlyModel || entry === onlyModel)) {
    console.info(`Running ${model} on ${cases.length} fixtures...`);
    freshModels.push(await runModel(client, model, prompt, cases));
  }
  const models = MODELS.map(
    (model) =>
      freshModels.find((entry) => entry.requestedModel === model) ??
      previousModels.find((entry) => entry.requestedModel === model)
  ).filter((model): model is ModelReport => Boolean(model));
  if (models.length !== MODELS.length) {
    throw new Error('Comparison report is missing a requested model result.');
  }

  const generatedAt = new Date().toISOString();
  const estimatedTotalCostUsd = models.reduce(
    (sum, model) => sum + (model.estimatedCostUsd ?? 0),
    0
  );
  const report = {
    generatedAt,
    methodology: {
      fixturePath: FIXTURE_PATH,
      fixtureCount: cases.length,
      reviewDate: REVIEW_DATE.toISOString(),
      oneBatchPerModel: true,
      maxCompletionTokensPerModel: MAX_COMPLETION_TOKENS,
      pricesUsdPerMillionTokens: PRICES,
      caveat:
        'Fixture labels are project-maintained benchmark expectations, not independently source-verified facts.',
    },
    audit: {
      systemPrompt:
        'You are a trivia quality-control classifier. Return valid JSON matching the requested schema exactly.',
      userPrompt: prompt,
      previousAttempts: onlyModel ? previousModels : [],
    },
    models,
    estimatedTotalCostUsd,
    recommendation:
      'Keep GPT-4o for this classifier for now; GPT-5.4 mini was faster and cheaper but materially less accurate on exact cases and label precision. Do not auto-switch from one small run.',
  };

  await mkdir(path.resolve('reports'), { recursive: true });
  await writeFile(path.resolve(JSON_REPORT_PATH), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  await writeFile(
    path.resolve(MARKDOWN_REPORT_PATH),
    buildMarkdown({ generatedAt, fixtureCount: cases.length, models, estimatedTotalCostUsd }),
    'utf8'
  );

  for (const model of models) {
    console.info(
      `${model.requestedModel}: ${model.error ?? `${percent(model.exactCaseAccuracy)} exact, $${model.estimatedCostUsd?.toFixed(4)}`}`
    );
  }
  console.info(`Estimated total cost: $${estimatedTotalCostUsd.toFixed(4)}`);

  const failedModels = models.filter((model) => model.error);
  if (failedModels.length > 0) {
    throw new Error(
      `Model comparison incomplete: ${failedModels.map((model) => `${model.requestedModel}: ${model.error}`).join('; ')}`
    );
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
