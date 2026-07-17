import OpenAI from 'openai';

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

export type FixableField =
  | 'sourceUrl'
  | 'sourceName'
  | 'explanation'
  | 'tags'
  | 'answer'
  | 'question'
  | 'acceptableAnswers';

interface QuestionContext {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
  explanation: string;
  pillar: string;
  tags: string[];
  sourceUrl: string | null;
  sourceName: string | null;
}

const PROMPTS: Record<FixableField, (q: QuestionContext) => string> = {
  sourceUrl: (q) =>
    `You are a trivia fact-checker. Given this trivia question and its correct answer, find the single best publicly accessible URL that directly verifies the answer.

Question: ${q.question}
Answer: ${q.answer}
Category: ${q.category}
Explanation: ${q.explanation || '(none)'}

Return ONLY a valid https:// URL to Wikipedia, a government site, a reputable encyclopedia, or another authoritative reference that clearly supports the answer. No explanation, no markdown — just the bare URL.`,

  sourceName: (q) =>
    `Given this source URL, return the canonical human-readable name of that source (e.g. "Wikipedia", "Statistics Canada", "National Geographic", "NASA").

Source URL: ${q.sourceUrl || '(unknown)'}
Question context: ${q.question} — Answer: ${q.answer}

Return ONLY the source name as a short string (1-5 words). No punctuation, no quotes, no explanation.`,

  explanation: (q) =>
    `Write a clear, concise factual explanation (1-3 sentences) for why "${q.answer}" is the correct answer to the following trivia question. Write as if explaining to a curious adult.

Question: ${q.question}
Answer: ${q.answer}
Category: ${q.category}

Return ONLY the explanation text. No preamble, no quotes.`,

  tags: (q) =>
    `Generate the correct tags array for this trivia question. Tags MUST include:
1. A region tag — exactly one of: "CA" (Canada-focused), "US" (United States-focused), or "Global" (neither/both)
2. The pillar name: "${q.pillar}"
3. The category name: "${q.category}"
You may add 1-2 additional descriptive tags if relevant (e.g. topic keywords).

Question: ${q.question}
Answer: ${q.answer}
Pillar: ${q.pillar}
Category: ${q.category}

Return ONLY a JSON array of strings, e.g. ["CA", "${q.pillar}", "${q.category}"]`,

  answer: (q) =>
    `You are a trivia fact-checker. The answer to the following question may be incorrect. Provide the single most accurate, unambiguous correct answer.

Question: ${q.question}
Current answer: ${q.answer}
Category: ${q.category}
Explanation: ${q.explanation || '(none)'}
${q.sourceUrl ? `Source: ${q.sourceUrl}` : ''}

Return ONLY the corrected answer as a short string. If the current answer is already correct, return it unchanged.`,

  question: (q) =>
    `Rephrase the following trivia question to make it clearer, less ambiguous, and more engaging while keeping the same answer.

Question: ${q.question}
Answer: ${q.answer}
Category: ${q.category}

Return ONLY the rephrased question. No explanation, no quotes.`,

  acceptableAnswers: (q) =>
    `List all reasonable acceptable variations of the answer to this trivia question. Include common abbreviations, alternate spellings, and partial answers that would be clearly correct.

Question: ${q.question}
Primary answer: ${q.answer}

Return ONLY a JSON array of strings. Include the primary answer plus any valid alternates. Example: ["${q.answer}", "alternate spelling"]`,
};

export async function getAiFieldFix(
  question: QuestionContext,
  field: FixableField
): Promise<string> {
  const prompt = PROMPTS[field](question);

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'system',
        content:
          'You are a precise trivia content assistant. Follow instructions exactly and return only what is asked — no preamble, no markdown, no extra explanation.',
      },
      { role: 'user', content: prompt },
    ],
    max_tokens: 512,
    temperature: 0.2,
  });

  const raw = response.choices[0]?.message?.content?.trim() ?? '';

  // Validate JSON fields return valid JSON
  if (field === 'tags' || field === 'acceptableAnswers') {
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      // Try to extract array from response
      const match = raw.match(/\[[\s\S]*\]/);
      if (match) return match[0];
      throw new Error(`AI returned invalid JSON for field "${field}": ${raw.slice(0, 100)}`);
    }
  }

  return raw;
}
