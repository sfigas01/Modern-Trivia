import OpenAI from 'openai';

import type { Question } from '@shared/models/questions';
import { TRIVIA_AI_REQUEST_CONFIG } from './ai-model-config';
import { buildQualityControlPrompt } from './quality-control-prompt';

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

export interface FactCheckVerdict {
  questionId: string;
  verdict: 'pass' | 'flag' | 'fail';
  /**
   * Question–answer coherence (STE-246): 'fail' when the question's premise is wrong or the
   * answer is not the type the question asks for (including negation/trick answers). A coherence
   * failure always forces `verdict` to 'fail'.
   */
  coherence: 'pass' | 'fail';
  /**
   * Obviousness (STE-247): 'fail' when the answer is derivable from the question text alone
   * (self-answering compound name/title, or a trivially binary/constrained framing) or when the
   * stated difficulty doesn't match how hard the question actually is. An obviousness failure
   * always forces `verdict` to 'fail'.
   */
  obviousness: 'pass' | 'fail';
  confidence: number;
  reason: string;
  /** Proposed rewritten question — fits the answer with the false premise removed (coherence), or
   *  a harder rephrasing/replacement that tests real knowledge (obviousness). */
  suggestedQuestion?: string;
  /** Recalibrated difficulty when obviousness fails due to a difficulty mislabel. */
  suggestedDifficulty?: 'Easy' | 'Medium' | 'Hard';
}

export interface FactCheckReport {
  totalChecked: number;
  results: FactCheckVerdict[];
}

const DIFFICULTY_LEVELS = new Set(['Easy', 'Medium', 'Hard']);

interface RawVerdict {
  id?: string;
  verdict?: string;
  coherence?: string;
  obviousness?: string;
  confidence?: number;
  reason?: string;
  suggestedQuestion?: string;
  suggestedDifficulty?: string;
}

const BATCH_SIZE = 50;

async function factCheckBatch(batch: Question[], reviewDate: Date): Promise<FactCheckVerdict[]> {
  if (batch.length === 0) return [];

  const prompt = buildQualityControlPrompt(batch, reviewDate);

  const startedAt = Date.now();
  console.info('[verifier] Fact-checking batch', { count: batch.length });

  try {
    const response = await getOpenAI().chat.completions.create({
      ...TRIVIA_AI_REQUEST_CONFIG,
      messages: [
        {
          role: 'system',
          content:
            'You are a trivia quality-control assistant. Always respond with valid JSON that matches the requested schema exactly.',
        },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as { results?: RawVerdict[] };
    const rawResults = Array.isArray(parsed.results) ? parsed.results : [];

    const resultMap = new Map<string, FactCheckVerdict>();
    for (const raw of rawResults) {
      const id = typeof raw.id === 'string' ? raw.id : '';
      if (!id) continue;
      let verdict = (['pass', 'flag', 'fail'] as const).includes(
        raw.verdict as 'pass' | 'flag' | 'fail'
      )
        ? (raw.verdict as 'pass' | 'flag' | 'fail')
        : 'flag';
      const coherence: 'pass' | 'fail' = raw.coherence === 'fail' ? 'fail' : 'pass';
      const obviousness: 'pass' | 'fail' = raw.obviousness === 'fail' ? 'fail' : 'pass';
      // A coherence or obviousness failure always forces an overall fail, even if the model left
      // verdict softer.
      if (coherence === 'fail' || obviousness === 'fail') verdict = 'fail';
      const suggestedQuestion =
        typeof raw.suggestedQuestion === 'string' && raw.suggestedQuestion.trim().length > 0
          ? raw.suggestedQuestion.trim()
          : undefined;
      const suggestedDifficulty = DIFFICULTY_LEVELS.has(raw.suggestedDifficulty ?? '')
        ? (raw.suggestedDifficulty as 'Easy' | 'Medium' | 'Hard')
        : undefined;
      resultMap.set(id, {
        questionId: id,
        verdict,
        coherence,
        obviousness,
        confidence:
          typeof raw.confidence === 'number' ? Math.min(100, Math.max(0, raw.confidence)) : 50,
        reason: typeof raw.reason === 'string' ? raw.reason : 'No reason provided.',
        ...(suggestedQuestion ? { suggestedQuestion } : {}),
        ...(suggestedDifficulty ? { suggestedDifficulty } : {}),
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
          coherence: 'pass' as const,
          obviousness: 'pass' as const,
          confidence: 0,
          reason: 'No verdict returned by fact-checker.',
        }
    );
  } catch (error) {
    console.error('[verifier] Batch fact-check failed', { error });
    return batch.map((q) => ({
      questionId: q.id,
      verdict: 'flag' as const,
      coherence: 'pass' as const,
      obviousness: 'pass' as const,
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

  // Split into chunks and process each with a single model call
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
