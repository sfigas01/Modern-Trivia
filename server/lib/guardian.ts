import OpenAI from 'openai';
import { insertQuestionSchema, type InsertQuestion } from '@shared/models/questions';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

type PendingQuestion = InsertQuestion & { status: 'pending' };

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
      "sourceUrl": "string or null",
      "sourceName": "string or null",
      "status": "pending"
    }
  ]
}

Rules:
- Return exactly ${normalizedCount} items.
- Use unique ids.
- Ensure all fields are filled and valid.
- status must always be "pending".`;

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

  try {
    const parsedResponse = JSON.parse(content) as { questions?: unknown } | unknown[];
    const rawQuestions = Array.isArray(parsedResponse)
      ? parsedResponse
      : Array.isArray(parsedResponse.questions)
        ? parsedResponse.questions
        : [];

    const validated = rawQuestions.map((item) =>
      insertQuestionWithPendingStatusSchema.parse(
        normalizeCandidate((item ?? {}) as GenerateQuestionInput, topic, pillar),
      ),
    ) as PendingQuestion[];

    if (validated.length !== normalizedCount) {
      throw new Error(`Expected ${normalizedCount} generated questions, got ${validated.length}`);
    }

    console.info('[guardian] Generated questions', {
      topic,
      pillar,
      count: validated.length,
      durationMs: Date.now() - startedAt,
    });

    return validated;
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
}
