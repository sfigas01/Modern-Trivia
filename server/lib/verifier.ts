import OpenAI from 'openai';

import { batchProcess } from '../replit_integrations/batch';
import type { Question } from '@shared/models/questions';

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
  verdict?: string;
  confidence?: number;
  reason?: string;
}

async function factCheckOne(question: Question): Promise<FactCheckVerdict> {
  const prompt = `You are a trivia fact-checker. Evaluate the accuracy of the following trivia question and answer.

Question: "${question.question}"
Answer: "${question.answer}"
Explanation: "${question.explanation}"

Respond with JSON:
{
  "verdict": "pass" | "flag" | "fail",
  "confidence": 0-100,
  "reason": "short explanation"
}

Guidelines:
- "pass": Factually correct and unambiguous
- "flag": Possibly outdated, ambiguous, or could use verification
- "fail": Clearly incorrect or misleading`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are a fact-checking assistant for a trivia game. Always respond with valid JSON.',
      },
      { role: 'user', content: prompt },
    ],
    response_format: { type: 'json_object' },
    max_tokens: 512,
  });

  const content = response.choices[0]?.message?.content || '{}';

  try {
    const parsed = JSON.parse(content) as RawVerdict;
    const verdict =
      parsed.verdict === 'pass' || parsed.verdict === 'fail' ? parsed.verdict : 'flag';
    return {
      questionId: question.id,
      verdict,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 50,
      reason: typeof parsed.reason === 'string' ? parsed.reason : 'No reason provided.',
    };
  } catch {
    return {
      questionId: question.id,
      verdict: 'flag',
      confidence: 0,
      reason: 'Failed to parse AI response.',
    };
  }
}

export async function batchFactCheck(questions: Question[]): Promise<FactCheckReport> {
  const results = await batchProcess(questions, (question) => factCheckOne(question), {
    concurrency: 3,
  });

  return {
    totalChecked: questions.length,
    results,
  };
}
