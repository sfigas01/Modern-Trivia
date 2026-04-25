import OpenAI from 'openai';

import type { Question } from '@shared/models/questions';
import { buildQualityControlPrompt } from './quality-control-prompt';

const openai = new OpenAI({
  apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

export interface FactCheckVerdict {
  questionId: string;
  verdict: 'pass' | 'flag' | 'fail';
  confidence: number;
  reason: string;
}

export interface FactCheckReport {
  totalChecked: number;
  results: FactCheckVerdict[];
}

interface RawVerdict {
  id?: string;
  verdict?: string;
  confidence?: number;
  reason?: string;
}

const BATCH_SIZE = 50;

async function factCheckBatch(batch: Question[], reviewDate: Date): Promise<FactCheckVerdict[]> {
  if (batch.length === 0) return [];

  const prompt = buildQualityControlPrompt(batch, reviewDate);

  const startedAt = Date.now();
  console.info('[verifier] Fact-checking batch', { count: batch.length });

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content:
            'You are a trivia quality-control assistant. Always respond with valid JSON that matches the requested schema exactly.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as { results?: RawVerdict[] };
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

    const resultMap = new Map<string, FactCheckVerdict>();
    for (const raw of rawResults) {
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) continue;
      const verdict = (['pass', 'flag', 'fail'] as const).includes(
        raw.verdict as 'pass' | 'flag' | 'fail'
      )
        ? (raw.verdict as 'pass' | 'flag' | 'fail')
        : 'flag';
      resultMap.set(id, {
        questionId: id,
        verdict,
        confidence:
          typeof raw.confidence === 'number' ? Math.min(100, Math.max(0, raw.confidence)) : 50,
        reason: typeof raw.reason === 'string' ? raw.reason : 'No reason provided.',
      });
    }

    console.info('[verifier] Batch complete', {
      count: batch.length,
      returned: resultMap.size,
      durationMs: Date.now() - startedAt,
    });

    // Fill in any questions the model missed
    return batch.map(
      (q) =>
        resultMap.get(q.id) ?? {
          questionId: q.id,
          verdict: 'flag' as const,
          confidence: 0,
          reason: 'No verdict returned by fact-checker.',
        }
    );
  } catch (error) {
    console.error('[verifier] Batch fact-check failed', { error });
    return batch.map((q) => ({
      questionId: q.id,
      verdict: 'flag' as const,
      confidence: 0,
      reason: 'Fact-check could not be completed.',
    }));
  }
}

export async function batchFactCheck(questions: Question[]): Promise<FactCheckReport> {
  if (questions.length === 0) {
    return { totalChecked: 0, results: [] };
  }

  console.info('[verifier] Running batch fact-check', { count: questions.length });
  const reviewDate = new Date();

  // Split into chunks and process each with a single GPT-4o call
  const chunks: Question[][] = [];
  for (let i = 0; i < questions.length; i += BATCH_SIZE) {
    chunks.push(questions.slice(i, i + BATCH_SIZE));
  }

  // Process chunks sequentially to avoid rate limits
  const allResults: FactCheckVerdict[] = [];
  for (const chunk of chunks) {
    const chunkResults = await factCheckBatch(chunk, reviewDate);
    allResults.push(...chunkResults);
  }

  console.info('[verifier] Full fact-check complete', { total: allResults.length });

  return {
    totalChecked: questions.length,
    results: allResults,
  };
}
