import OpenAI from 'openai';
import { insertQuestionSchema, type InsertQuestion } from '@shared/models/questions';
import { auditQuestionQuality, type QuestionQualityFinding } from './question-quality-audit';
import { batchFactCheck, type FactCheckResult } from './verifier';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface QuestionAiAnalysis {
  qaFindings: QuestionQualityFinding[];
  factCheck: FactCheckResult;
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
  pillar: string,
): GenerateQuestionInput {
  return {
    ...raw,
    id: typeof raw.id === 'string' && raw.id.trim().length > 0 ? raw.id : crypto.randomUUID(),
    category:
      typeof raw.category === 'string' && raw.category.trim().length > 0 ? raw.category : topic,
    pillar,
    status: 'pending',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    acceptableAnswers: Array.isArray(raw.acceptableAnswers) ? raw.acceptableAnswers : [],
  };
}

export async function generateQuestions(
  topic: string,
  count: number,
  pillar: string,
): Promise<PendingQuestion[]> {
  const normalizedCount = Math.max(1, Math.min(20, Math.floor(count || 1)));
  const startedAt = Date.now();

  console.info('[guardian] Generating questions', {
    topic,
    pillar,
    count: normalizedCount,
  });

  const prompt = `Generate ${normalizedCount} trivia questions about "${topic}" for the "${pillar}" pillar.

Return only valid JSON in this exact envelope:
{
  "questions": [
    {
      "id": "uuid",
      "category": "string",
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
    }
  ]
}

Rules:
- Return exactly ${normalizedCount} items.
- Use unique ids.
- Ensure all fields are filled and valid.
- status must always be "pending".
- tags must include a region tag (CA, US, or Global), the pillar name, and the category name.
- sourceUrl MUST be a real, publicly accessible URL (Wikipedia, official government site, reputable encyclopedia, or authoritative reference) that directly supports the stated answer. Never use null, empty string, or a placeholder.
- sourceName MUST be the human-readable name of that source (e.g. "Wikipedia", "Statistics Canada", "National Geographic"). Never use null or empty string.
- If you cannot provide a verifiable source for a question, do not include that question — generate a different one instead.`;

  let content = '{}';

  try {
    const response = await openai.chat.completions.create({
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
        normalizeCandidate((item ?? {}) as GenerateQuestionInput, topic, pillar),
      ),
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

  const [auditReport, factCheckMap] = await Promise.all([
    Promise.resolve(auditQuestionQuality(validated)),
    batchFactCheck(
      validated.map((q) => ({
        id: q.id as string,
        question: q.question,
        answer: q.answer,
        explanation: q.explanation,
      })),
    ),
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
    const factCheck = factCheckMap.get(id) ?? { verdict: 'flag' as const, confidence: 0, reason: 'No verdict returned.' };

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
      pass: Array.from(factCheckMap.values()).filter((v) => v.verdict === 'pass').length,
      flag: Array.from(factCheckMap.values()).filter((v) => v.verdict === 'flag').length,
      fail: Array.from(factCheckMap.values()).filter((v) => v.verdict === 'fail').length,
    },
    durationMs: Date.now() - startedAt,
  });

  return questionsWithAnalysis;
}
