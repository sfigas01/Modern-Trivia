import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export type FactCheckVerdict = 'pass' | 'flag' | 'fail';

export interface FactCheckResult {
  verdict: FactCheckVerdict;
  confidence: number;
  reason: string;
}

interface QuestionInput {
  id: string;
  question: string;
  answer: string;
  explanation: string;
}

interface RawVerdict {
  id?: string;
  verdict?: string;
  confidence?: number;
  reason?: string;
}

export async function batchFactCheck(
  questions: QuestionInput[],
): Promise<Map<string, FactCheckResult>> {
  const results = new Map<string, FactCheckResult>();

  if (questions.length === 0) return results;

  const startedAt = Date.now();
  console.info('[verifier] Running batch fact-check', { count: questions.length });

  const prompt = `You are a trivia fact-checker. Review each question and verify factual accuracy.

For each question return one of:
- "pass"  — question, answer, and explanation are all factually correct and unambiguous
- "flag"  — likely correct but uncertain, minor wording concern, or hard to verify
- "fail"  — factually wrong, misleading, or the answer is clearly incorrect

Return valid JSON:
{
  "results": [
    {
      "id": "<question id>",
      "verdict": "pass" | "flag" | "fail",
      "confidence": 0-100,
      "reason": "one sentence explaining the verdict"
    }
  ]
}

Questions to review:
${JSON.stringify(questions.map((q) => ({ id: q.id, question: q.question, answer: q.answer, explanation: q.explanation })), null, 2)}`;

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a trivia fact-checking assistant. Always respond with valid JSON that matches the requested schema exactly.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 2048,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as { results?: RawVerdict[] };
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

    for (const raw of rawResults) {
      const id = typeof raw.id === 'string' ? raw.id : '';
      const verdict = (['pass', 'flag', 'fail'] as const).includes(raw.verdict as FactCheckVerdict)
        ? (raw.verdict as FactCheckVerdict)
        : 'flag';
      const confidence = typeof raw.confidence === 'number' ? Math.min(100, Math.max(0, raw.confidence)) : 50;
      const reason = typeof raw.reason === 'string' ? raw.reason : 'No reason provided.';

      if (id) {
        results.set(id, { verdict, confidence, reason });
      }
    }

    console.info('[verifier] Batch fact-check complete', {
      count: questions.length,
      returned: results.size,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    console.error('[verifier] Batch fact-check failed', { error });
    for (const q of questions) {
      results.set(q.id, { verdict: 'flag', confidence: 0, reason: 'Fact-check could not be completed.' });
    }
  }

  for (const q of questions) {
    if (!results.has(q.id)) {
      results.set(q.id, { verdict: 'flag', confidence: 0, reason: 'No verdict returned by fact-checker.' });
    }
  }

  return results;
}
