import stringSimilarity from 'string-similarity';
import type { Question } from '@shared/models/questions';

export interface TopicContextOptions {
  topic: string;
  pillar: string;
  existing: Pick<Question, 'id' | 'question' | 'answer' | 'pillar'>[];
  maxExamples?: number;
}

export interface TopicContextExample {
  question: string;
  answer: string;
}

const DEFAULT_MAX_EXAMPLES = 30;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function selectTopicContext(opts: TopicContextOptions): TopicContextExample[] {
  const maxExamples = opts.maxExamples ?? DEFAULT_MAX_EXAMPLES;
  if (maxExamples <= 0 || opts.existing.length === 0) return [];

  const normalizedTopic = normalize(opts.topic);

  const samePillar = opts.existing.filter((q) => q.pillar === opts.pillar);
  const otherPillar = opts.existing.filter((q) => q.pillar !== opts.pillar);

  const scored = (
    items: Pick<Question, 'id' | 'question' | 'answer' | 'pillar'>[]
  ): Array<{ q: Pick<Question, 'id' | 'question' | 'answer' | 'pillar'>; score: number }> =>
    items
      .map((q) => ({
        q,
        score: normalizedTopic
          ? stringSimilarity.compareTwoStrings(normalizedTopic, normalize(q.question))
          : 0,
      }))
      .sort((a, b) => b.score - a.score);

  const sortedSamePillar = scored(samePillar);

  let chosen: typeof sortedSamePillar = sortedSamePillar.slice(0, maxExamples);

  if (chosen.length < maxExamples) {
    const remaining = maxExamples - chosen.length;
    const sortedOther = scored(otherPillar).slice(0, remaining);
    chosen = chosen.concat(sortedOther);
  }

  return chosen.map(({ q }) => ({ question: q.question, answer: q.answer }));
}
