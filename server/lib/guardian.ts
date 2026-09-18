import OpenAI from 'openai';
import { insertQuestionSchema, type InsertQuestion, type Question } from '@shared/models/questions';
import { auditQuestionQuality, type QuestionQualityFinding } from './question-quality-audit';
import { batchFactCheck, type FactCheckVerdict } from './verifier';
import { VALID_CATEGORIES, CATEGORY_SET, LEGACY_CATEGORY_MAP } from '@shared/constants/categories';

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({
      apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
    });
  }
  return _openai;
}

export interface QuestionAiAnalysis {
  qaFindings: QuestionQualityFinding[];
  factCheck: FactCheckVerdict;
  repaired?: boolean;
}

export interface ExistingExample {
  question: string;
  answer: string;
}

const MAX_EXISTING_EXAMPLES = 30;

// --- Coverage planning (STE-249) ---
// Before generating, ask the model to plan an entity x angle grid of distinct subtopics for the
// topic, diffed against what the existing examples already cover, so generation targets
// unexplored territory instead of regressing to the same few obvious facts.
const COVERAGE_ANGLES = ['who', 'what', 'when', 'where', 'record', 'origin', 'connection'] as const;
type CoverageAngle = (typeof COVERAGE_ANGLES)[number];

export interface CoverageCell {
  subtopic: string;
  angle: CoverageAngle;
}

function fallbackCoveragePlan(topic: string, count: number): CoverageCell[] {
  return Array.from({ length: count }, (_, i) => ({
    subtopic: topic,
    angle: COVERAGE_ANGLES[i % COVERAGE_ANGLES.length],
  }));
}

function buildCoveragePlanBlock(cells: CoverageCell[]): string {
  if (cells.length === 0) return '';
  const list = cells
    .map((c, i) => `${i + 1}. Subtopic: "${c.subtopic}" — Angle: ${c.angle}`)
    .join('\n');
  return `Coverage plan — write exactly ONE question per cell below, matching that cell's specific subtopic and angle, in order. Do not skip a cell or write more than one question for the same cell:\n${list}\n`;
}

async function planCoverage(
  topic: string,
  pillar: string,
  count: number,
  existingExamples: ExistingExample[]
): Promise<CoverageCell[]> {
  const existingBlock =
    existingExamples.length > 0
      ? existingExamples
          .slice(0, MAX_EXISTING_EXAMPLES)
          .map((ex, i) => `${i + 1}. ${ex.question}`)
          .join('\n')
      : '(none yet — this is the first batch for this topic)';

  const prompt = `Plan coverage for a trivia batch about "${topic}" (pillar: "${pillar}").

Use an entity x angle grid to find distinct, unexplored angles. Angles: who, what, when, where, record, origin, connection.

Questions already written about this topic (do not repeat their subtopic + angle combination):
${existingBlock}

Return exactly ${count} DISTINCT cells — each a specific subtopic within "${topic}" paired with one angle from the list above — that are NOT already covered by the existing questions. Every cell must be answerable from a knowable, verifiable fact; target "interesting but knowable" — do not plan cells that would require obscure or unanswerable trivia.

Return only valid JSON:
{ "cells": [ { "subtopic": "string", "angle": "who|what|when|where|record|origin|connection" } ] }`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You plan diverse trivia coverage grids. Always return valid JSON matching the requested schema.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as { cells?: unknown };
    const rawCells = Array.isArray(parsed.cells) ? parsed.cells : [];

    const cells: CoverageCell[] = [];
    for (const raw of rawCells) {
      const subtopic =
        typeof (raw as { subtopic?: unknown })?.subtopic === 'string'
          ? (raw as { subtopic: string }).subtopic.trim()
          : '';
      if (!subtopic) continue;
      const angleRaw =
        typeof (raw as { angle?: unknown })?.angle === 'string'
          ? (raw as { angle: string }).angle.trim().toLowerCase()
          : '';
      const angle: CoverageAngle = (COVERAGE_ANGLES as readonly string[]).includes(angleRaw)
        ? (angleRaw as CoverageAngle)
        : 'what';
      cells.push({ subtopic, angle });
    }

    if (cells.length === 0) {
      console.warn(
        '[guardian] Coverage plan returned no usable cells — falling back to angle rotation',
        { topic, pillar }
      );
      return fallbackCoveragePlan(topic, count);
    }

    if (cells.length >= count) return cells.slice(0, count);

    // Model returned fewer distinct cells than requested — top up with the angle-rotation
    // fallback rather than generating a short batch.
    const fallback = fallbackCoveragePlan(topic, count);
    return [...cells, ...fallback.slice(cells.length)];
  } catch (error) {
    console.error('[guardian] Coverage planning failed — falling back to angle rotation', {
      topic,
      pillar,
      error,
    });
    return fallbackCoveragePlan(topic, count);
  }
}

// --- Strategy quotas (STE-249) ---
// CONTENT_STRATEGY.md's pillar distribution target. Used to allocate a Mixed-pillar batch across
// pillars using live inventory counts, so generation closes strategy gaps instead of amplifying
// whatever skew already exists in the pool.
export type StrategyPillar = 'TimeCapsule' | 'GlobalEh' | 'FreshPrints' | 'GreatOutdoors';

export const STRATEGY_PILLAR_TARGETS: Record<StrategyPillar, number> = {
  TimeCapsule: 0.3,
  GlobalEh: 0.3,
  FreshPrints: 0.25,
  GreatOutdoors: 0.15,
};

export interface PillarQuota {
  pillar: StrategyPillar;
  count: number;
}

/**
 * Allocate `count` new questions across the CONTENT_STRATEGY.md pillars, weighting toward
 * whichever pillars are currently under-represented in the live pool relative to their target
 * share. With an empty or evenly-distributed pool this reduces to the plain 30/30/25/15 split.
 */
export function computeStrategyQuotas(
  existingCountsByPillar: Partial<Record<StrategyPillar, number>>,
  count: number
): PillarQuota[] {
  const pillars = Object.keys(STRATEGY_PILLAR_TARGETS) as StrategyPillar[];
  const totalExisting = pillars.reduce((sum, p) => sum + (existingCountsByPillar[p] ?? 0), 0);

  const weights = pillars.map((pillar) => {
    const target = STRATEGY_PILLAR_TARGETS[pillar];
    const currentShare =
      totalExisting > 0 ? (existingCountsByPillar[pillar] ?? 0) / totalExisting : target;
    const deficit = target - currentShare;
    // A pillar under its target share gets boosted by its deficit; one at or above target still
    // keeps a floor of a tenth of its target share so it's never starved to zero.
    return { pillar, weight: Math.max(target + deficit, target * 0.1) };
  });

  const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0);
  const items = weights.map((w) => {
    const raw = totalWeight > 0 ? (w.weight / totalWeight) * count : count / pillars.length;
    return { pillar: w.pillar, weight: w.weight, floored: Math.floor(raw), remainder: raw % 1 };
  });

  let remaining = count - items.reduce((sum, i) => sum + i.floored, 0);
  items.sort((a, b) => b.remainder - a.remainder || b.weight - a.weight);
  for (let i = 0; i < remaining; i++) items[i].floored++;

  return items.filter((i) => i.floored > 0).map((i) => ({ pillar: i.pillar, count: i.floored }));
}

type PendingQuestion = InsertQuestion & { status: 'pending'; aiAnalysis: QuestionAiAnalysis };

const insertQuestionWithPendingStatusSchema = insertQuestionSchema.transform((question) => ({
  ...question,
  status: 'pending' as const,
}));

interface GenerateQuestionInput {
  id?: unknown;
  category?: unknown;
  difficulty?: unknown;
  question?: unknown;
  answer?: unknown;
  acceptableAnswers?: unknown;
  explanation?: unknown;
  pillar?: unknown;
  tags?: unknown;
  sourceUrl?: unknown;
  sourceName?: unknown;
  status?: unknown;
}

function normalizeCandidate(
  raw: GenerateQuestionInput,
  topic: string,
  pillar: string
): GenerateQuestionInput {
  const rawCategory = typeof raw.category === 'string' ? raw.category.trim() : '';
  // Only accept the AI-supplied category if it matches a canonical value; otherwise
  // default to 'History & Geography' and log so the mismatch is visible.
  let category: string;
  if (CATEGORY_SET.has(rawCategory)) {
    category = rawCategory;
  } else {
    const mapped = LEGACY_CATEGORY_MAP[rawCategory.toLowerCase()];
    if (mapped) {
      console.warn('[guardian] AI returned legacy category — mapping to canonical', {
        received: rawCategory,
        topic,
        mappedTo: mapped,
      });
      category = mapped;
    } else {
      console.warn('[guardian] AI returned non-canonical category — defaulting', {
        received: rawCategory || '(empty)',
        topic,
        defaulting: VALID_CATEGORIES[0],
      });
      category = VALID_CATEGORIES[0];
    }
  }

  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : crypto.randomUUID(),
    category,
    pillar,
    status: 'pending',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    acceptableAnswers: Array.isArray(raw.acceptableAnswers) ? raw.acceptableAnswers : [],
  };
}

const QUESTION_JSON_SCHEMA = (pillar: string) => `{
  "id": "uuid",
  "category": "History & Geography | Science & Nature | Sports | Entertainment & Pop Culture | Food & Culture | Technology",
  "difficulty": "Easy | Medium | Hard",
  "question": "string",
  "answer": "string",
  "acceptableAnswers": ["string"],
  "explanation": "string",
  "pillar": "${pillar}",
  "tags": ["string"],
  "sourceUrl": "https://...",
  "sourceName": "string",
  "status": "pending"
}`;

function buildNegativeExamplesBlock(examples: ExistingExample[]): string {
  if (examples.length === 0) return '';
  const trimmed = examples.slice(0, MAX_EXISTING_EXAMPLES);
  const list = trimmed
    .map((ex, i) => `${i + 1}. Q: "${ex.question}" — A: "${ex.answer}"`)
    .join('\n');
  return `\nAvoid generating questions that overlap in fact or framing with these existing questions on this topic. Each new question must test a DIFFERENT fact. Do not paraphrase, do not change the wording slightly to ask the same thing.\n\nExisting questions to avoid:\n${list}\n`;
}

const QUESTION_RULES = (pillar: string) => `Rules:
- Use a unique UUID as id.
- Ensure all fields are filled and valid.
- status must always be "pending".
- category MUST be exactly one of: ${VALID_CATEGORIES.map((c) => `"${c}"`).join(', ')}. Choose the best fit for the question content.
- tags must include a region tag (CA, US, or Global), the pillar name, and the category name.
- sourceUrl MUST be a real, publicly accessible URL (Wikipedia, official government site, reputable encyclopedia, or authoritative reference) that directly supports the stated answer. Never use null, empty string, or a placeholder.
- sourceName MUST be the human-readable name of that source (e.g. "Wikipedia", "Statistics Canada", "National Geographic"). Never use null or empty string.
- If you cannot provide a verifiable source for a question, write a different question instead.
- pillar must be "${pillar}".`;

function isHardFailure(q: PendingQuestion): boolean {
  return (
    q.aiAnalysis.factCheck.verdict === 'fail' ||
    q.aiAnalysis.qaFindings.some((f) => f.severity === 'high')
  );
}

function describeFailures(q: PendingQuestion): string[] {
  const reasons: string[] = [];
  const factCheck = q.aiAnalysis.factCheck;
  let attributed = false;
  if (factCheck.coherence === 'fail') {
    attributed = true;
    const rewrite = factCheck.suggestedQuestion
      ? ` — suggested rewrite: "${factCheck.suggestedQuestion}"`
      : '';
    reasons.push(`Coherence FAIL: ${factCheck.reason}${rewrite}`);
  }
  if (factCheck.obviousness === 'fail') {
    attributed = true;
    const hints = [
      factCheck.suggestedQuestion ? `suggested rewrite: "${factCheck.suggestedQuestion}"` : null,
      factCheck.suggestedDifficulty
        ? `suggested difficulty: ${factCheck.suggestedDifficulty}`
        : null,
    ].filter((hint): hint is string => hint !== null);
    const suffix = hints.length > 0 ? ` — ${hints.join('; ')}` : '';
    reasons.push(`Obviousness FAIL: ${factCheck.reason}${suffix}`);
  }
  if (!attributed && factCheck.verdict === 'fail') {
    reasons.push(`Fact-check FAIL: ${factCheck.reason}`);
  }
  for (const finding of q.aiAnalysis.qaFindings.filter((f) => f.severity === 'high')) {
    reasons.push(`QA high-severity [${finding.rule}]: ${finding.message}`);
  }
  return reasons;
}

async function runQaOnSingle(
  q: ReturnType<typeof insertQuestionWithPendingStatusSchema.parse>
): Promise<PendingQuestion> {
  const id = q.id as string;
  const [auditReport, factCheckReport] = await Promise.all([
    Promise.resolve(auditQuestionQuality([q])),
    batchFactCheck([{ ...q, id } as unknown as Question]),
  ]);

  const qaFindings = auditReport.findings.filter((f) => f.questionId === id);
  const factCheck: FactCheckVerdict = factCheckReport.results.find((r) => r.questionId === id) ?? {
    questionId: id,
    verdict: 'flag' as const,
    coherence: 'pass' as const,
    obviousness: 'pass' as const,
    confidence: 0,
    reason: 'No verdict returned.',
  };

  return { ...q, status: 'pending' as const, aiAnalysis: { qaFindings, factCheck } };
}

async function repairQuestion(
  original: PendingQuestion,
  topic: string,
  pillar: string,
  failureReasons: string[],
  existingExamples: ExistingExample[] = []
): Promise<PendingQuestion | null> {
  const originalJson = JSON.stringify(
    {
      id: original.id,
      category: original.category,
      difficulty: original.difficulty,
      question: original.question,
      answer: original.answer,
      acceptableAnswers: original.acceptableAnswers,
      explanation: original.explanation,
      pillar: original.pillar,
      tags: original.tags,
      sourceUrl: original.sourceUrl,
      sourceName: original.sourceName,
    },
    null,
    2
  );

  const repairPrompt = `The following trivia question about "${topic}" for the "${pillar}" pillar failed quality checks.

Original question:
${originalJson}

Failures found:
${failureReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}

Please return a corrected version of this question that fixes ALL of the failures above. If the answer itself is factually wrong, either correct it or replace the question entirely with a different fact about "${topic}". Keep the same pillar and general topic area. Keep the same difficulty unless a failure above specifies a corrected difficulty, in which case use that difficulty instead.

Return valid JSON for exactly ONE question using this schema:
${QUESTION_JSON_SCHEMA(pillar)}

${QUESTION_RULES(pillar)}
${buildNegativeExamplesBlock(existingExamples)}`;

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You repair and correct trivia questions. Always return valid JSON for exactly one question matching the requested schema.',
        },
        { role: 'user', content: repairPrompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 1024,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const raw = JSON.parse(content) as GenerateQuestionInput;

    const normalized = normalizeCandidate({ ...raw, id: crypto.randomUUID() }, topic, pillar);
    const validated = insertQuestionWithPendingStatusSchema.parse(normalized);
    const repaired = await runQaOnSingle(validated);

    if (isHardFailure(repaired)) {
      console.warn('[guardian] Repaired question still fails QA — dropping', {
        originalId: original.id,
        repairedId: repaired.id,
        factVerdict: repaired.aiAnalysis.factCheck.verdict,
        highFindings: repaired.aiAnalysis.qaFindings.filter((f) => f.severity === 'high').length,
      });
      return null;
    }

    const analysis = repaired.aiAnalysis as QuestionAiAnalysis;
    return { ...repaired, aiAnalysis: { ...analysis, repaired: true } };
  } catch (error) {
    console.error('[guardian] Repair attempt failed', { originalId: original.id, error });
    return null;
  }
}

export async function generateQuestions(
  topic: string,
  count: number,
  pillar: string,
  existingExamples: ExistingExample[] = []
): Promise<PendingQuestion[]> {
  const normalizedCount = Math.max(1, Math.min(20, Math.floor(count || 1)));
  const startedAt = Date.now();

  console.info('[guardian] Generating questions', {
    topic,
    pillar,
    count: normalizedCount,
    negativeExamples: Math.min(existingExamples.length, MAX_EXISTING_EXAMPLES),
  });

  const coverageCells = await planCoverage(topic, pillar, normalizedCount, existingExamples);
  console.info('[guardian] Coverage plan', {
    topic,
    pillar,
    cells: coverageCells.map((c) => `${c.subtopic} (${c.angle})`),
  });

  const prompt = `Generate exactly ${normalizedCount} trivia questions about "${topic}" for the "${pillar}" pillar.

${buildCoveragePlanBlock(coverageCells)}
Return only valid JSON in this exact envelope:
{
  "questions": [
    ${QUESTION_JSON_SCHEMA(pillar)}
  ]
}

${QUESTION_RULES(pillar)}
- Return exactly ${normalizedCount} items, one per coverage cell above, in the same order.
${buildNegativeExamplesBlock(existingExamples)}`;

  let content = '{}';

  try {
    const response = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You generate structured trivia content. Always return valid JSON that matches the requested schema.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    });

    content = response.choices[0]?.message?.content || '{}';
  } catch (error) {
    console.error('[guardian] OpenAI request failed', {
      topic,
      pillar,
      count: normalizedCount,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw new Error('Failed to generate questions from OpenAI.', { cause: error });
  }

  let validated: ReturnType<typeof insertQuestionWithPendingStatusSchema.parse>[];

  try {
    const parsedResponse = JSON.parse(content) as { questions?: unknown } | unknown[];
    const rawQuestions = Array.isArray(parsedResponse)
      ? parsedResponse
      : Array.isArray((parsedResponse as { questions?: unknown }).questions)
        ? (parsedResponse as { questions: unknown[] }).questions
        : [];

    validated = rawQuestions.map((item) =>
      insertQuestionWithPendingStatusSchema.parse(
        normalizeCandidate((item ?? {}) as GenerateQuestionInput, topic, pillar)
      )
    );

    if (validated.length !== normalizedCount) {
      throw new Error(`Expected ${normalizedCount} generated questions, got ${validated.length}`);
    }

    console.info('[guardian] Generated questions', {
      topic,
      pillar,
      count: validated.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[guardian] Failed to parse/validate generated questions', {
      topic,
      pillar,
      count: normalizedCount,
      durationMs: Date.now() - startedAt,
      contentPreview: content.slice(0, 300),
      error,
    });
    throw new Error('Failed to parse or validate generated questions.', { cause: error });
  }

  // Run QA pipeline: static audit + AI fact-check (in parallel)
  console.info('[guardian] Running QA pipeline', { count: validated.length });

  const [auditReport, factCheckReport] = await Promise.all([
    Promise.resolve(auditQuestionQuality(validated)),
    batchFactCheck(validated as unknown as Question[]),
  ]);

  // Build a per-question findings map from the audit report
  const findingsByQuestionId = new Map<string, QuestionQualityFinding[]>();
  for (const finding of auditReport.findings) {
    const existing = findingsByQuestionId.get(finding.questionId) ?? [];
    existing.push(finding);
    findingsByQuestionId.set(finding.questionId, existing);
  }

  // Attach aiAnalysis to each question
  const questionsWithAnalysis: PendingQuestion[] = validated.map((q) => {
    const id = q.id as string;
    const qaFindings = findingsByQuestionId.get(id) ?? [];
    const factCheck: FactCheckVerdict = factCheckReport.results.find(
      (r) => r.questionId === id
    ) ?? {
      questionId: id,
      verdict: 'flag' as const,
      coherence: 'pass' as const,
      obviousness: 'pass' as const,
      confidence: 0,
      reason: 'No verdict returned.',
    };

    return {
      ...q,
      status: 'pending' as const,
      aiAnalysis: { qaFindings, factCheck },
    };
  });

  console.info('[guardian] QA pipeline complete', {
    topic,
    pillar,
    flaggedByQA: auditReport.flaggedQuestionCount,
    factCheckSummary: {
      pass: factCheckReport.results.filter((v) => v.verdict === 'pass').length,
      flag: factCheckReport.results.filter((v) => v.verdict === 'flag').length,
      fail: factCheckReport.results.filter((v) => v.verdict === 'fail').length,
    },
    // STE-247 obviousness check, run on this batch via verifier.batchFactCheck above — surfaced
    // separately so obscurity drift is visible even when the overall verdict is a softer 'flag'.
    obviousnessFails: factCheckReport.results.filter((v) => v.obviousness === 'fail').length,
    durationMs: Date.now() - startedAt,
  });

  // --- Repair pass ---
  // Identify hard failures: fact-check 'fail' or any high-severity QA finding.
  // Attempt to auto-repair each one in parallel. Questions that can't be repaired are dropped.
  const passing: PendingQuestion[] = [];
  const toRepair: PendingQuestion[] = [];

  for (const q of questionsWithAnalysis) {
    if (isHardFailure(q)) {
      toRepair.push(q);
    } else {
      passing.push(q);
    }
  }

  if (toRepair.length > 0) {
    console.info('[guardian] Repair pass starting', {
      topic,
      pillar,
      failCount: toRepair.length,
    });

    const repairResults = await Promise.all(
      toRepair.map((q) => repairQuestion(q, topic, pillar, describeFailures(q), existingExamples))
    );

    let repairedCount = 0;
    let droppedCount = 0;

    for (const result of repairResults) {
      if (result !== null) {
        passing.push(result);
        repairedCount++;
      } else {
        droppedCount++;
      }
    }

    console.info('[guardian] Repair pass complete', {
      topic,
      pillar,
      repairedCount,
      droppedCount,
      finalCount: passing.length,
      durationMs: Date.now() - startedAt,
    });
  }

  return passing;
}
