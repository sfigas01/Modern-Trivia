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
  if (factCheck.coherence === 'fail') {
    const rewrite = factCheck.suggestedQuestion
      ? ` — suggested rewrite: "${factCheck.suggestedQuestion}"`
      : '';
    reasons.push(`Coherence FAIL: ${factCheck.reason}${rewrite}`);
  } else if (factCheck.verdict === 'fail') {
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

Please return a corrected version of this question that fixes ALL of the failures above. If the answer itself is factually wrong, either correct it or replace the question entirely with a different fact about "${topic}". Keep the same pillar, difficulty, and general topic area.

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

  const prompt = `Generate ${normalizedCount} trivia questions about "${topic}" for the "${pillar}" pillar.

Return only valid JSON in this exact envelope:
{
  "questions": [
    ${QUESTION_JSON_SCHEMA(pillar)}
  ]
}

${QUESTION_RULES(pillar)}
- Return exactly ${normalizedCount} items.
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
