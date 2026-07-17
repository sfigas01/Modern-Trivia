import OpenAI from 'openai';
import type { QuestionQualityFinding } from './question-quality-audit';
import type { Question } from '@shared/models/questions';

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

interface SubjectivityAnalysis {
  questionId: string;
  subjectivePart: string;
  proposedQuestion: string;
}

export async function enrichSubjectiveFindings(
  findings: QuestionQualityFinding[],
  allQuestions: Question[]
): Promise<void> {
  const subjectiveFindings = findings.filter((f) => f.rule === 'subjective_prompt');
  if (subjectiveFindings.length === 0) return;

  const qMap = new Map(allQuestions.map((q) => [q.id, q]));
  const payload = subjectiveFindings
    .map((f) => {
      const q = qMap.get(f.questionId);
      return q ? { questionId: f.questionId, question: q.question, answer: q.answer } : null;
    })
    .filter(Boolean);

  if (payload.length === 0) return;

  const systemPrompt = `You are a trivia question editor. For each flagged question, identify the specific word or short phrase that makes it subjective (opinion-based rather than factual), and propose a rewritten version that is objective and has a single verifiable correct answer. Keep the same general topic and ensure the provided answer still works. Be concise — the rewritten question should be roughly the same length as the original.`;

  const userPrompt = `Return a JSON array (no markdown, raw JSON only) where each element has:
- "questionId": the question's ID (string, copy exactly)
- "subjectivePart": the exact subjective word or phrase in the original question (keep it short, 1-5 words)
- "proposedQuestion": a rewritten version of the question that is factual and objective

Questions to analyze:
${JSON.stringify(payload, null, 2)}`;

  try {
    const resp = await getOpenAI().chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const raw = resp.choices[0]?.message?.content ?? '{}';
    const parsed = JSON.parse(raw);
    const results: SubjectivityAnalysis[] = Array.isArray(parsed)
      ? parsed
      : (parsed.results ?? parsed.questions ?? Object.values(parsed)[0] ?? []);

    for (const result of results) {
      const finding = subjectiveFindings.find((f) => f.questionId === result.questionId);
      if (finding && result.subjectivePart && result.proposedQuestion) {
        finding.proposedFix = {
          subjectivePart: result.subjectivePart,
          proposedQuestion: result.proposedQuestion,
        };
      }
    }
  } catch (err) {
    console.error('[subjectivity-enricher] Failed to enrich findings:', err);
  }
}
