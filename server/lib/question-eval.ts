import { VALID_CATEGORIES } from '@shared/constants/categories';

/**
 * Offline question-quality evaluation (STE-304).
 *
 * Compares question generators against an owner's blind ratings, then measures how well an
 * LLM judge agrees with those ratings. Development-time only: nothing here runs in the
 * production request path, and nothing writes to the database.
 *
 * This module is pure (no network, no filesystem) so it can be tested with fakes. The CLI in
 * `script/question-eval.ts` supplies the real OpenAI, Wikipedia and file I/O.
 *
 * Rubric and decision rules: docs/guides/trivia_quality_rubric.md and
 * docs/guides/question_eval.md.
 */

export const QUESTION_EVAL_SCHEMA_VERSION = 'question-eval-v1' as const;

export type EvalPillar = 'TimeCapsule' | 'GlobalEh' | 'FreshPrints' | 'GreatOutdoors';
/** An arm's id from the run config, e.g. "A", "A2", "B". */
export type EvalArm = string;
/** An arm id, or one of the two anchor groups. */
export type ItemGroup = EvalArm;
export type AnchorGroup = 'library' | 'planted';
export type Difficulty = 'Easy' | 'Medium' | 'Hard';
export type YesNo = 'y' | 'n';
export type YesNoUnsure = 'y' | 'n' | 'u';
export type Verdict = 'keep' | 'fix' | 'drop';

/** How one arm generates questions. Arms are declared per round in the run config. */
export interface ArmSpec {
  id: EvalArm;
  label: string;
  /** "guardian": generateQuestions() as is. "guardian-wikipedia": grounded generation + Guardian QA. */
  generator: 'guardian' | 'guardian-wikipedia';
  /** Optional style guide passed to Guardian (see trivia-style-guide.ts). */
  styleGuide?: 'v2';
}

/** Round 1 files predate per-run arm specs; they always had these two arms. */
export const ROUND_1_ARMS: ArmSpec[] = [
  { id: 'A', label: 'A: Guardian as is', generator: 'guardian' },
  { id: 'B', label: 'B: Guardian + Wikipedia passages', generator: 'guardian-wikipedia' },
];

const ANCHOR_LABELS: Record<AnchorGroup, string> = {
  library: 'Library anchors',
  planted: 'Planted bad',
};

export function armsOf(file: Pick<CandidatesFile, 'arms'>): ArmSpec[] {
  return file.arms && file.arms.length > 0 ? file.arms : ROUND_1_ARMS;
}

export function groupLabel(group: ItemGroup, arms: ArmSpec[]): string {
  return arms.find((a) => a.id === group)?.label ?? ANCHOR_LABELS[group as AnchorGroup] ?? group;
}

export function isArmGroup(group: ItemGroup, arms: ArmSpec[]): boolean {
  return arms.some((a) => a.id === group);
}

export interface EvalTheme {
  id: string;
  theme: string;
  pillar: EvalPillar;
  kind: 'standard' | 'canadian' | 'niche' | 'fresh';
  note?: string;
}

export interface EvalQuestion {
  question: string;
  answer: string;
  acceptableAnswers: string[];
  explanation: string;
  difficulty: Difficulty;
  category: string;
  pillar: EvalPillar;
  region: 'CA' | 'US' | 'Global';
  sourceUrl: string;
  sourceName: string;
}

/** Guardian's own QA verdict on a generated question, kept so it can be compared with the owner. */
export interface GuardianVerdict {
  verdict: string;
  coherence: string;
  obviousness: string;
  confidence: number | null;
  highFindings: number;
  repaired: boolean;
}

export interface Candidate {
  id: string;
  group: ItemGroup;
  themeId: string | null;
  theme: string;
  question: EvalQuestion;
  guardian: GuardianVerdict | null;
}

export interface ArmRunStats {
  arm: EvalArm;
  themeId: string;
  requested: number;
  delivered: number;
  /** Questions generated but removed by the QA gate or schema validation (arm B only; arm A hides it). */
  droppedByGate: number | null;
  error: string | null;
  latencyMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export interface GroundingArticle {
  title: string;
  url: string;
  characters: number;
}

export interface CandidatesFile {
  schemaVersion: typeof QUESTION_EVAL_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  generationModel: string;
  questionsPerThemePerArm: number;
  /** Absent in round 1 files (see ROUND_1_ARMS). */
  arms?: ArmSpec[];
  themes: EvalTheme[];
  candidates: Candidate[];
  stats: ArmRunStats[];
  grounding: Record<string, GroundingArticle[]>;
}

// ---------------------------------------------------------------------------
// Spend tracking
// ---------------------------------------------------------------------------

/**
 * USD per million tokens, Standard tier. Cached-input discounts are ignored, so recorded cost is
 * an upper bound. Sources: gpt-5.4-mini from script/offline-model-comparison.ts (2026-09);
 * gpt-6.1-sol from docs/guides/theme-provider-evaluation-plan.md (checked 2026-10-17).
 * Recheck https://developers.openai.com/api/docs/pricing before relying on the totals.
 */
export const MODEL_PRICES_PER_MILLION: Record<string, { input: number; output: number }> = {
  'gpt-5.4-mini': { input: 0.75, output: 4.5 },
  'gpt-6.1-sol': { input: 2.5, output: 10 },
};

export function priceForModel(model: string): { input: number; output: number } | null {
  if (MODEL_PRICES_PER_MILLION[model]) return MODEL_PRICES_PER_MILLION[model];
  // Dated snapshots (e.g. gpt-5.4-mini-2026-03-17) share their alias's price.
  const alias = Object.keys(MODEL_PRICES_PER_MILLION)
    .sort((a, b) => b.length - a.length)
    .find((name) => model.startsWith(`${name}-`));
  return alias ? MODEL_PRICES_PER_MILLION[alias] : null;
}

export class SpendLimitError extends Error {
  constructor(spentUsd: number, maxUsd: number) {
    super(`Spend limit reached: $${spentUsd.toFixed(4)} of $${maxUsd.toFixed(2)}`);
    this.name = 'SpendLimitError';
  }
}

/** Tallies token usage and cost, and refuses new requests once the cap is reached. */
export class SpendTracker {
  totalUsd = 0;
  inputTokens = 0;
  outputTokens = 0;
  requests = 0;

  constructor(readonly maxUsd: number) {}

  /** Call before dispatching a request. Throws once the cap is reached. */
  assertWithinLimit(): void {
    if (this.totalUsd >= this.maxUsd) throw new SpendLimitError(this.totalUsd, this.maxUsd);
  }

  record(model: string, inputTokens: number, outputTokens: number): void {
    const price = priceForModel(model);
    // An unpriced model would make the cap meaningless, so the CLI refuses unknown models up
    // front; if one slips through, charge the most expensive known price.
    const fallback = Object.values(MODEL_PRICES_PER_MILLION).reduce((a, b) =>
      a.output > b.output ? a : b
    );
    const { input, output } = price ?? fallback;
    this.inputTokens += inputTokens;
    this.outputTokens += outputTokens;
    this.requests += 1;
    this.totalUsd += (inputTokens * input + outputTokens * output) / 1_000_000;
  }

  snapshot(): { usd: number; inputTokens: number; outputTokens: number } {
    return { usd: this.totalUsd, inputTokens: this.inputTokens, outputTokens: this.outputTokens };
  }
}

/** Reads token usage from either a Chat Completions or a Responses API body. */
export function extractUsage(body: unknown): { input: number; output: number } | null {
  if (!body || typeof body !== 'object') return null;
  const usage = (body as { usage?: Record<string, unknown> }).usage;
  if (!usage || typeof usage !== 'object') return null;
  const input = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0);
  const output = Number(usage.completion_tokens ?? usage.output_tokens ?? 0);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  return { input, output };
}

// ---------------------------------------------------------------------------
// Generation orchestration
// ---------------------------------------------------------------------------

export interface ArmOutput {
  questions: Array<{ question: EvalQuestion; guardian: GuardianVerdict | null }>;
  droppedByGate: number | null;
  grounding?: GroundingArticle[];
}

export interface GenerationDeps {
  generate(arm: ArmSpec, theme: EvalTheme, count: number): Promise<ArmOutput>;
  now(): number;
  log?(message: string): void;
}

/**
 * Runs every arm for every theme, one at a time. A failure in one arm/theme is recorded and the
 * run continues; hitting the spend cap stops everything.
 */
export async function runGeneration(
  themes: EvalTheme[],
  arms: ArmSpec[],
  count: number,
  deps: GenerationDeps,
  tracker: SpendTracker,
  /** Optional filter, used to retry only the arm/theme pairs that failed in an earlier run. */
  only?: (arm: EvalArm, themeId: string) => boolean
): Promise<Pick<CandidatesFile, 'candidates' | 'stats' | 'grounding'>> {
  const candidates: Candidate[] = [];
  const stats: ArmRunStats[] = [];
  const grounding: Record<string, GroundingArticle[]> = {};

  for (const theme of themes) {
    for (const spec of arms) {
      const arm = spec.id;
      if (only && !only(arm, theme.id)) continue;
      const before = tracker.snapshot();
      const startedAt = deps.now();
      let output: ArmOutput | null = null;
      let error: string | null = null;
      try {
        output = await deps.generate(spec, theme, count);
      } catch (caught) {
        if (caught instanceof SpendLimitError) throw caught;
        error = caught instanceof Error ? caught.message : String(caught);
      }
      const after = tracker.snapshot();
      const delivered = output?.questions.length ?? 0;
      stats.push({
        arm,
        themeId: theme.id,
        requested: count,
        delivered,
        droppedByGate: output?.droppedByGate ?? null,
        error,
        latencyMs: deps.now() - startedAt,
        costUsd: after.usd - before.usd,
        inputTokens: after.inputTokens - before.inputTokens,
        outputTokens: after.outputTokens - before.outputTokens,
      });
      if (output?.grounding) grounding[theme.id] = output.grounding;
      output?.questions.forEach((item, index) => {
        candidates.push({
          id: `${arm}-${theme.id}-${index + 1}`,
          group: arm,
          themeId: theme.id,
          theme: theme.theme,
          question: item.question,
          guardian: item.guardian,
        });
      });
      deps.log?.(
        `${spec.label} | ${theme.theme}: ${delivered}/${count}` +
          (error ? ` (error: ${error})` : '') +
          ` | $${(after.usd - before.usd).toFixed(4)}`
      );
    }
  }
  return { candidates, stats, grounding };
}

/** Arm/theme pairs whose generation failed outright (not ones that merely delivered fewer). */
export function failedPairs(file: CandidatesFile): Array<{ arm: EvalArm; themeId: string }> {
  return file.stats.filter((s) => s.error).map((s) => ({ arm: s.arm, themeId: s.themeId }));
}

/**
 * Replaces the retried pairs' stats and candidates in an earlier run with the new attempt.
 * The earlier failed attempt's cost is added to the retry's cost so total spend stays honest.
 */
export function mergeRetriedGeneration(
  previous: CandidatesFile,
  retried: Pick<CandidatesFile, 'candidates' | 'stats' | 'grounding'>
): CandidatesFile {
  const retriedKeys = new Set(retried.stats.map((s) => `${s.arm}:${s.themeId}`));
  const isRetried = (arm: string, themeId: string | null) =>
    themeId !== null && retriedKeys.has(`${arm}:${themeId}`);
  const stats = [
    ...previous.stats.filter((s) => !isRetried(s.arm, s.themeId)),
    ...retried.stats.map((s) => {
      const old = previous.stats.find((p) => p.arm === s.arm && p.themeId === s.themeId);
      // Fold the failed attempt's spend into the retry so cost per arm includes it.
      return old ? { ...s, costUsd: s.costUsd + old.costUsd } : s;
    }),
  ];
  return {
    ...previous,
    candidates: [
      ...previous.candidates.filter((c) => !isRetried(c.group, c.themeId)),
      ...retried.candidates,
    ],
    stats,
    grounding: { ...previous.grounding, ...retried.grounding },
  };
}

// ---------------------------------------------------------------------------
// Normalizing model output
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asDifficulty(value: unknown): Difficulty | null {
  const text = asString(value).toLowerCase();
  if (text === 'easy') return 'Easy';
  if (text === 'medium') return 'Medium';
  if (text === 'hard') return 'Hard';
  return null;
}

/** Accepts a region string or a Guardian-style tags array; defaults to Global. */
export function asRegion(value: unknown): 'CA' | 'US' | 'Global' {
  const values = Array.isArray(value) ? value.map(asString) : [asString(value)];
  if (values.includes('CA')) return 'CA';
  if (values.includes('US')) return 'US';
  return 'Global';
}

/** Turns one raw generated object into an EvalQuestion, or null when required fields are missing. */
export function normalizeGeneratedQuestion(raw: unknown, pillar: EvalPillar): EvalQuestion | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const question = asString(r.question);
  const answer = asString(r.answer);
  const difficulty = asDifficulty(r.difficulty);
  const sourceUrl = asString(r.sourceUrl);
  if (!question || !answer || !difficulty || !/^https?:\/\//.test(sourceUrl)) return null;
  const categoryText = asString(r.category);
  const category =
    (VALID_CATEGORIES as readonly string[]).find(
      (c) => c.toLowerCase() === categoryText.toLowerCase()
    ) ?? 'Entertainment & Pop Culture';
  return {
    question,
    answer,
    acceptableAnswers: Array.isArray(r.acceptableAnswers)
      ? r.acceptableAnswers.map(asString).filter(Boolean)
      : [],
    explanation: asString(r.explanation),
    difficulty,
    category,
    pillar,
    region: asRegion(r.region ?? r.tags),
    sourceUrl,
    sourceName: asString(r.sourceName) || 'Wikipedia',
  };
}

// ---------------------------------------------------------------------------
// Wikipedia grounding (arm B)
// ---------------------------------------------------------------------------

export const WIKIPEDIA_API = 'https://en.wikipedia.org/w/api.php';
export const WIKIPEDIA_USER_AGENT = 'modern-trivia-question-eval/1.0 (offline research script)';

export function buildWikipediaSearchUrl(theme: string, limit: number): string {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: theme,
    srlimit: String(limit),
    srnamespace: '0',
    format: 'json',
    formatversion: '2',
  });
  return `${WIKIPEDIA_API}?${params.toString()}`;
}

export function buildWikipediaExtractUrl(title: string): string {
  const params = new URLSearchParams({
    action: 'query',
    prop: 'extracts|info',
    inprop: 'url',
    explaintext: '1',
    redirects: '1',
    titles: title,
    format: 'json',
    formatversion: '2',
  });
  return `${WIKIPEDIA_API}?${params.toString()}`;
}

const TRAILING_SECTIONS =
  /\n==+\s*(See also|References|Notes|Citations|Sources|Further reading|External links|Bibliography)\s*==+/i;

/** Drops reference sections and blank runs, then truncates on a paragraph boundary. */
export function cleanWikipediaExtract(text: string, maxChars: number): string {
  const cut = text.search(TRAILING_SECTIONS);
  const body = (cut >= 0 ? text.slice(0, cut) : text).replace(/\n{3,}/g, '\n\n').trim();
  if (body.length <= maxChars) return body;
  const truncated = body.slice(0, maxChars);
  const lastBreak = truncated.lastIndexOf('\n');
  return (lastBreak > maxChars * 0.5 ? truncated.slice(0, lastBreak) : truncated).trim();
}

export function buildGroundedPrompt(
  theme: EvalTheme,
  count: number,
  articles: Array<{ title: string; url: string; text: string }>
): string {
  const passages = articles
    .map((a, i) => `[Article ${i + 1}] ${a.title}\nURL: ${a.url}\n${a.text}`)
    .join('\n\n---\n\n');
  return `Write exactly ${count} trivia questions about "${theme.theme}" for the "${theme.pillar}" pillar of a Canadian-friendly party trivia game for adults aged 18-50.

Use ONLY facts stated in the Wikipedia articles below. Every answer must be directly supported by the article text. Spread the questions across different articles and different facts. Prefer facts that are surprising, memorable or fun to discuss over dry definitions. Avoid US-centric framing.

Mix the difficulty: roughly a quarter Easy, half Medium and a quarter Hard. Hard means harder to reason out, not obscure.

${passages}

Return only valid JSON in this envelope:
{
  "questions": [
    {
      "category": ${VALID_CATEGORIES.map((c) => `"${c}"`).join(' | ')},
      "difficulty": "Easy" | "Medium" | "Hard",
      "region": "CA" | "US" | "Global",
      "question": "string",
      "answer": "string",
      "acceptableAnswers": ["string"],
      "explanation": "one or two sentences shown after the answer is revealed",
      "sourceUrl": "the URL of the article that supports the answer",
      "sourceName": "Wikipedia"
    }
  ]
}

Rules:
- Exactly ${count} items.
- The answer must not appear in the question.
- Each question has one defensible answer. List common alternative spellings in acceptableAnswers.
- sourceUrl must be one of the article URLs above.`;
}

// ---------------------------------------------------------------------------
// Evidence check (correctness gate candidate)
// ---------------------------------------------------------------------------

/**
 * A candidate always-on correctness check: look the claim up on Wikipedia and require a
 * verbatim supporting quote, instead of trusting a model's memory. Steps:
 *  1. a cheap model proposes Wikipedia search queries for the claim;
 *  2. the script fetches the top articles and keeps the passages most related to the Q&A;
 *  3. a strong model returns supported / contradicted / not_found with an exact quote;
 *  4. the quote must appear in the fetched text, or the decision falls back to "hold".
 */

export type EvidenceVerdict = 'supported' | 'contradicted' | 'not_found';

export interface EvidenceResult {
  verdict: EvidenceVerdict;
  quote: string;
  url: string;
  quoteVerified: boolean;
  otherAnswers: string[];
  reason: string;
  decision: GateDecision;
}

const STOPWORDS = new Set(
  'the a an and or of in on at to for from by with which what who whom whose when where why how is was were are be been this that these those its it as into about than then there their his her him she he they them one first name named called known also most more'.split(
    ' '
  )
);

function keywords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 3 && !STOPWORDS.has(w))
    )
  );
}

/**
 * Keeps the paragraphs most related to the question and answer, in article order, up to
 * maxChars. A paragraph that mentions the answer itself always ranks first.
 */
export function selectPassages(text: string, question: EvalQuestion, maxChars: number): string {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40 && !/^=+.*=+$/.test(p));
  const questionWords = keywords(question.question);
  const answerWords = keywords([question.answer, ...question.acceptableAnswers].join(' '));
  const answerPhrase = question.answer.toLowerCase();
  const scored = paragraphs.map((p, index) => {
    const lower = p.toLowerCase();
    const words = new Set(keywords(p));
    const score =
      (lower.includes(answerPhrase) ? 10 : 0) +
      answerWords.filter((w) => words.has(w)).length * 3 +
      questionWords.filter((w) => words.has(w)).length;
    return { p, index, score };
  });
  const chosen: typeof scored = [];
  let used = 0;
  for (const entry of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (entry.score === 0) break;
    if (used + entry.p.length > maxChars) continue;
    chosen.push(entry);
    used += entry.p.length;
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((c) => c.p)
    .join('\n\n');
}

function claimPayload(theme: string, q: EvalQuestion) {
  return {
    theme,
    question: q.question,
    answer: q.answer,
    also_accept: q.acceptableAnswers,
    explanation: q.explanation,
  };
}

export function buildEvidenceQueryPrompt(theme: string, q: EvalQuestion): string {
  return `A trivia question needs to be fact-checked against English Wikipedia.

${JSON.stringify(claimPayload(theme, q), null, 2)}

Write up to 2 short Wikipedia search queries (a few words each, like article titles) that would find the article confirming or refuting the answer. Prefer the specific subject of the question over the broad theme.

Return only JSON: { "queries": ["...", "..."] }`;
}

export function parseEvidenceQueries(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { queries?: unknown };
    return Array.isArray(parsed.queries)
      ? parsed.queries
          .filter((q): q is string => typeof q === 'string' && q.trim().length > 0)
          .map((q) => q.trim().slice(0, 120))
          .slice(0, 2)
      : [];
  } catch {
    return [];
  }
}

export function buildEvidenceVerdictPrompt(
  theme: string,
  q: EvalQuestion,
  articles: Array<{ title: string; url: string; passages: string }>
): string {
  const evidence = articles
    .map((a, i) => `[Source ${i + 1}] ${a.title}\nURL: ${a.url}\n${a.passages}`)
    .join('\n\n---\n\n');
  return `You are fact-checking a trivia question for a party game. Judge it ONLY against the Wikipedia passages below, not your own memory.

${JSON.stringify(claimPayload(theme, q), null, 2)}

Passages:
${evidence || '(no passages were found)'}

Decide:
- "supported": a passage states the answer to this exact question, including any premise in the question (dates, places, "first", "Canadian" and so on).
- "contradicted": a passage shows the answer or the question's premise is wrong.
- "not_found": the passages do not settle it either way.

Quote rule: "quote" must be ONE sentence copied exactly, character for character, from the passages above. It is checked by computer; a quote that is not in the passages makes your verdict void. Use "" when the verdict is "not_found".

Also list in "other_answers" any other answers the passages show would also be correct (empty if none).

Return only JSON:
{ "verdict": "supported" | "contradicted" | "not_found", "quote": "...", "url": "the URL of the quoted source", "other_answers": [], "reason": "one short sentence" }`;
}

function normalizeForQuote(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parses the strong model's verdict and checks its quote against the fetched passages. Only a
 * quote found in the passages can pass or reject a question; anything else is "hold".
 */
export function parseEvidenceVerdict(raw: string, passagesText: string): EvidenceResult {
  const hold = (reason: string): EvidenceResult => ({
    verdict: 'not_found',
    quote: '',
    url: '',
    quoteVerified: false,
    otherAnswers: [],
    reason,
    decision: 'hold',
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(
      raw
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
    );
  } catch {
    return hold('evidence response was not valid JSON');
  }
  const verdictText = String(parsed.verdict ?? '');
  const verdict: EvidenceVerdict =
    verdictText === 'supported' || verdictText === 'contradicted' ? verdictText : 'not_found';
  const quote = typeof parsed.quote === 'string' ? parsed.quote.trim() : '';
  const quoteVerified =
    quote.length >= 12 && normalizeForQuote(passagesText).includes(normalizeForQuote(quote));
  const decision: GateDecision =
    verdict === 'supported' && quoteVerified
      ? 'pass'
      : verdict === 'contradicted' && quoteVerified
        ? 'fail'
        : 'hold';
  return {
    verdict,
    quote,
    url: typeof parsed.url === 'string' ? parsed.url : '',
    quoteVerified,
    otherAnswers: Array.isArray(parsed.other_answers)
      ? parsed.other_answers.filter((a): a is string => typeof a === 'string')
      : [],
    reason: typeof parsed.reason === 'string' ? parsed.reason : '',
    decision,
  };
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function escapeCsvCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
}

/** RFC 4180 parser: quoted cells, escaped quotes, embedded newlines, CRLF and a leading BOM. */
export function parseCsv(text: string): string[][] {
  const input = text.replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

// ---------------------------------------------------------------------------
// Blind review sheet
// ---------------------------------------------------------------------------

export const SHEET_CONTENT_COLUMNS = [
  'item',
  'theme',
  'question',
  'answer',
  'also_accept',
  'explanation',
  'stated_difficulty',
  'source',
] as const;

export const RATING_COLUMNS = [
  'correct',
  'one_answer',
  'fun',
  'difficulty',
  'fits',
  'verdict',
  'why',
] as const;

export interface BlindKeyEntry {
  candidateId: string;
  group: ItemGroup;
  themeId: string | null;
}

/** Deterministic PRNG so a sheet can be regenerated identically from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFromString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function shuffle<T>(items: T[], seed: number): T[] {
  const random = mulberry32(seed);
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Shuffles every candidate into one blind sheet. The sheet never reveals the group; the key file
 * maps blind item IDs back to candidates.
 */
export function buildBlindSheet(
  candidates: Candidate[],
  seed: number
): {
  csv: string;
  key: Record<string, BlindKeyEntry>;
  order: Array<{ item: string; candidate: Candidate }>;
} {
  const shuffled = shuffle(candidates, seed);
  const width = String(shuffled.length).length;
  const key: Record<string, BlindKeyEntry> = {};
  const order: Array<{ item: string; candidate: Candidate }> = [];
  const rows: string[][] = [[...SHEET_CONTENT_COLUMNS, ...RATING_COLUMNS]];
  shuffled.forEach((candidate, index) => {
    const item = `Q${String(index + 1).padStart(width, '0')}`;
    key[item] = { candidateId: candidate.id, group: candidate.group, themeId: candidate.themeId };
    order.push({ item, candidate });
    const q = candidate.question;
    rows.push([
      item,
      candidate.theme,
      q.question,
      q.answer,
      q.acceptableAnswers.join('; '),
      q.explanation,
      q.difficulty,
      q.sourceUrl,
      ...RATING_COLUMNS.map(() => ''),
    ]);
  });
  return { csv: toCsv(rows), key, order };
}

// ---------------------------------------------------------------------------
// Ratings (owner or judge)
// ---------------------------------------------------------------------------

export interface Rating {
  correct: YesNoUnsure;
  oneAnswer: YesNo;
  fun: number;
  difficulty: Difficulty;
  fits: YesNo;
  verdict: Verdict;
  why: string;
}

function parseYesNo(value: string, allowUnsure: boolean): YesNoUnsure | null {
  const v = value.trim().toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(v)) return 'y';
  if (['n', 'no', 'false', '0'].includes(v)) return 'n';
  if (allowUnsure && ['u', 'unsure', '?', 'not sure', 'maybe'].includes(v)) return 'u';
  return null;
}

function parseVerdict(value: string): Verdict | null {
  const v = value.trim().toLowerCase();
  if (['keep', 'k'].includes(v)) return 'keep';
  if (['fix', 'f', 'repair'].includes(v)) return 'fix';
  if (['drop', 'd', 'reject'].includes(v)) return 'drop';
  return null;
}

function parseDifficultyCell(value: string): Difficulty | null {
  const v = value.trim().toLowerCase();
  if (['e', 'easy'].includes(v)) return 'Easy';
  if (['m', 'medium', 'med'].includes(v)) return 'Medium';
  if (['h', 'hard'].includes(v)) return 'Hard';
  return null;
}

/** Validates one rating. Returns the parsed rating, or a list of problems. */
export function parseRatingFields(fields: Record<string, string>): Rating | string[] {
  const problems: string[] = [];
  const correct = parseYesNo(fields.correct ?? '', true);
  const oneAnswer = parseYesNo(fields.one_answer ?? '', false);
  const funText = (fields.fun ?? '').trim();
  const fun = /^[1-5]$/.test(funText) ? Number(funText) : NaN;
  const difficulty = parseDifficultyCell(fields.difficulty ?? '');
  const fits = parseYesNo(fields.fits ?? '', false);
  const verdict = parseVerdict(fields.verdict ?? '');
  if (!correct) problems.push('correct must be y, n or u');
  if (!oneAnswer) problems.push('one_answer must be y or n');
  if (Number.isNaN(fun)) problems.push('fun must be 1-5');
  if (!difficulty) problems.push('difficulty must be E, M or H');
  if (!fits) problems.push('fits must be y or n');
  if (!verdict) problems.push('verdict must be keep, fix or drop');
  if (problems.length > 0) return problems;
  return {
    correct: correct!,
    oneAnswer: oneAnswer as YesNo,
    fun,
    difficulty: difficulty!,
    fits: fits as YesNo,
    verdict: verdict!,
    why: (fields.why ?? '').trim(),
  };
}

export interface ParsedRatings {
  ratings: Map<string, Rating>;
  unrated: string[];
  errors: string[];
}

/** Reads a filled-in review sheet. Rows with every rating cell blank count as unrated, not errors. */
export function parseRatingsCsv(text: string, key: Record<string, BlindKeyEntry>): ParsedRatings {
  const rows = parseCsv(text);
  const ratings = new Map<string, Rating>();
  const unrated: string[] = [];
  const errors: string[] = [];
  if (rows.length === 0) return { ratings, unrated: Object.keys(key), errors: ['sheet is empty'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const itemIndex = header.indexOf('item');
  const missing = RATING_COLUMNS.filter((c) => !header.includes(c));
  if (itemIndex < 0 || missing.length > 0) {
    return {
      ratings,
      unrated: Object.keys(key),
      errors: [
        `sheet header is missing: ${['item', ...missing].filter((c) => !header.includes(c)).join(', ')}`,
      ],
    };
  }
  const seen = new Set<string>();
  for (const row of rows.slice(1)) {
    const item = (row[itemIndex] ?? '').trim();
    if (!item) continue;
    if (!key[item]) {
      errors.push(`${item}: not in this run's key`);
      continue;
    }
    if (seen.has(item)) {
      errors.push(`${item}: appears more than once`);
      continue;
    }
    seen.add(item);
    const fields: Record<string, string> = {};
    for (const column of RATING_COLUMNS) fields[column] = row[header.indexOf(column)] ?? '';
    const ratingCells = RATING_COLUMNS.filter((c) => c !== 'why').map((c) => fields[c].trim());
    if (ratingCells.every((c) => c === '')) {
      unrated.push(item);
      continue;
    }
    const parsed = parseRatingFields(fields);
    if (Array.isArray(parsed)) errors.push(`${item}: ${parsed.join('; ')}`);
    else ratings.set(item, parsed);
  }
  for (const item of Object.keys(key)) if (!seen.has(item)) unrated.push(item);
  return { ratings, unrated: unrated.sort(), errors };
}

// ---------------------------------------------------------------------------
// LLM judge
// ---------------------------------------------------------------------------

/** Mirrors docs/guides/trivia_quality_rubric.md. Keep them in sync. */
export const JUDGE_RUBRIC = `You are rating questions for Modern Trivia, a party trivia game for Canadian adults aged 18-50, played in groups on a shared screen. The content strategy favours Canadian-friendly, globally relevant questions and avoids US-centric defaults.

Rate each question on these fields:

correct (gate): "y" if the answer is correct as stated, "n" if it is wrong or rests on a false premise, "u" if you cannot tell. Use your own knowledge; the source URL is shown but you cannot open it.

one_answer (gate): "y" if there is one defensible answer (accepted alternatives cover reasonable variants). "n" if several answers are equally right, the wording is vague, or it depends on opinion.

fun (1-5): how good it is as party trivia.
  1 = dry textbook restatement, an arbitrary number or date, or list recall. Nobody would care.
  2 = correct but flat; feels like an exam.
  3 = fine and fair, but forgettable.
  4 = a good party question: people can reason toward it, and the reveal is satisfying.
  5 = people would talk about it after the game: surprising, nostalgic, or sparks debate.
  Things that raise fun: the room can reason toward it and partial knowledge helps; the reveal lands ("of course!" or "no way!"); this audience recognizes the subject or would enjoy learning it; it sparks nostalgia or discussion; it is short and reads well aloud.
  Things that lower fun: trick wording, obscure for its own sake, a giveaway, a Wikipedia first sentence turned into a question.

difficulty: "E", "M" or "H" - how hard it really is for a typical adult in this audience. Easy: most players get it. Medium: about half. Hard: few, but it is still fair.

fits (y/n): fits Modern Trivia - Canadian-friendly or globally relevant, not US-default, suitable for a mixed adult group, and on the stated theme.

verdict: "keep" (use as is), "fix" (good fact but the wording, answer list or difficulty label needs work), or "drop" (wrong, ambiguous, dull or off-brand).
  Any "n" on correct or one_answer means the verdict cannot be "keep".

why: one short sentence explaining the verdict.`;

export interface JudgeItem {
  item: string;
  theme: string;
  question: EvalQuestion;
}

/** Judge rubric versions: v1 is JUDGE_RUBRIC alone; v2 adds the owner calibration from round 1. */
export type JudgeRubricVersion = 'v1' | 'v2';

export function buildJudgePrompt(items: JudgeItem[], calibration?: string): string {
  const rubric = calibration?.trim() ? `${JUDGE_RUBRIC}\n\n${calibration.trim()}` : JUDGE_RUBRIC;
  const payload = items.map(({ item, theme, question }) => ({
    item,
    theme,
    question: question.question,
    answer: question.answer,
    also_accept: question.acceptableAnswers,
    explanation: question.explanation,
    stated_difficulty: question.difficulty,
    source: question.sourceUrl,
  }));
  return `${rubric}

Rate every question below. Rate each one on its own merits; they come from several unrelated sources.

${JSON.stringify(payload, null, 2)}

Return only JSON in this shape, with one entry per item, in the same order:
{
  "ratings": [
    { "item": "Q01", "correct": "y", "one_answer": "y", "fun": 3, "difficulty": "M", "fits": "y", "verdict": "keep", "why": "..." }
  ]
}`;
}

export function parseJudgeResponse(
  raw: string,
  expectedItems: string[]
): { ratings: Map<string, Rating>; problems: string[] } {
  const ratings = new Map<string, Rating>();
  const problems: string[] = [];
  let parsed: unknown;
  try {
    const trimmed = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '');
    parsed = JSON.parse(trimmed);
  } catch {
    return { ratings, problems: ['judge response was not valid JSON'] };
  }
  const list = (parsed as { ratings?: unknown }).ratings;
  if (!Array.isArray(list)) return { ratings, problems: ['judge response has no ratings array'] };
  const expected = new Set(expectedItems);
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const fields = Object.fromEntries(
      Object.entries(entry as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')])
    );
    const item = (fields.item ?? '').trim();
    if (!expected.has(item) || ratings.has(item)) continue;
    const rating = parseRatingFields(fields);
    if (Array.isArray(rating)) problems.push(`${item}: ${rating.join('; ')}`);
    else ratings.set(item, rating);
  }
  for (const item of expectedItems) {
    if (!ratings.has(item) && !problems.some((p) => p.startsWith(`${item}:`)))
      problems.push(`${item}: missing from judge response`);
  }
  return { ratings, problems };
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Wilson score interval (95%) for a proportion. */
export function wilsonInterval(
  successes: number,
  total: number
): { low: number; high: number } | null {
  if (total === 0) return null;
  const z = 1.959964;
  const p = successes / total;
  const denominator = 1 + (z * z) / total;
  const centre = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  return { low: Math.max(0, centre - margin), high: Math.min(1, centre + margin) };
}

/** Cohen's kappa for two raters over the same categorical labels. */
export function cohenKappa<T>(pairs: Array<[T, T]>): number | null {
  if (pairs.length === 0) return null;
  const labels = Array.from(new Set(pairs.flat()));
  const n = pairs.length;
  const observed = pairs.filter(([a, b]) => a === b).length / n;
  let expected = 0;
  for (const label of labels) {
    const a = pairs.filter(([x]) => x === label).length / n;
    const b = pairs.filter(([, y]) => y === label).length / n;
    expected += a * b;
  }
  if (expected === 1) return observed === 1 ? 1 : null;
  return (observed - expected) / (1 - expected);
}

function averageRanks(values: number[]): number[] {
  const indexed = values
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1].value === indexed[i].value) j++;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[indexed[k].index] = rank;
    i = j + 1;
  }
  return ranks;
}

/** Spearman rank correlation with average ranks for ties. Null when either side is constant. */
export function spearman(x: number[], y: number[]): number | null {
  if (x.length !== y.length || x.length < 3) return null;
  const rx = averageRanks(x);
  const ry = averageRanks(y);
  const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
  const mx = mean(rx);
  const my = mean(ry);
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  if (dx === 0 || dy === 0) return null;
  return num / Math.sqrt(dx * dy);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface GroupSummary {
  group: ItemGroup;
  total: number;
  rated: number;
  keep: number;
  fix: number;
  drop: number;
  keepInterval: { low: number; high: number } | null;
  incorrect: number;
  unsure: number;
  ambiguous: number;
  notFitting: number;
  funMean: number | null;
  difficultyMatches: number;
}

export interface ArmOperations {
  arm: EvalArm;
  requested: number;
  delivered: number;
  errors: number;
  droppedByGate: number | null;
  costUsd: number;
  latencyMs: number;
  kept: number;
  costPerKeptUsd: number | null;
}

export interface JudgeAgreement {
  compared: number;
  verdictAgreement: number | null;
  keepAgreement: number | null;
  keepKappa: number | null;
  ownerIncorrect: number;
  judgeCaughtIncorrect: number;
  judgeFalseIncorrect: number;
  funSpearman: number | null;
  plantedTotal: number;
  plantedRejectedByOwner: number;
  plantedRejectedByJudge: number;
  disagreements: Array<{ item: string; owner: Verdict; judge: Verdict; judgeWhy: string }>;
}

export interface EvalReport {
  runId: string;
  generationModel: string;
  judgeModel: string | null;
  groups: GroupSummary[];
  arms: ArmOperations[];
  byTheme: Array<{
    themeId: string;
    theme: string;
    arm: EvalArm;
    rated: number;
    keep: number;
    funMean: number | null;
  }>;
  guardianMisses: { passedButOwnerIncorrect: number; ratedGenerated: number };
  judge: JudgeAgreement | null;
  /** Present when facts.csv (hand-verified truth labels) exists for the run. */
  factChecks: FactCheckerScore[] | null;
  armSpecs: ArmSpec[];
  unrated: string[];
  ratingErrors: string[];
}

/** Hand-verified truth for one item, from facts.csv. */
export type FactTruth = 'correct' | 'incorrect' | 'unverifiable';

/** What one correctness signal said about an item, collapsed to a gate decision. */
export type GateDecision = 'pass' | 'fail' | 'hold';

export interface FactCheckerScore {
  checker: string;
  /** Items with a truth label of correct or incorrect that this checker gave a decision on. */
  scored: number;
  incorrect: number;
  incorrectFailed: number;
  incorrectHeld: number;
  incorrectPassed: number;
  correct: number;
  correctFailed: number;
  correctHeld: number;
  correctPassed: number;
}

/** Scores each correctness signal against the truth labels. Unverifiable truth labels are skipped. */
export function scoreFactCheckers(
  truth: Map<string, FactTruth>,
  checkers: Array<{ name: string; decisions: Map<string, GateDecision> }>
): FactCheckerScore[] {
  return checkers.map(({ name, decisions }) => {
    const score: FactCheckerScore = {
      checker: name,
      scored: 0,
      incorrect: 0,
      incorrectFailed: 0,
      incorrectHeld: 0,
      incorrectPassed: 0,
      correct: 0,
      correctFailed: 0,
      correctHeld: 0,
      correctPassed: 0,
    };
    truth.forEach((label, item) => {
      const decision = decisions.get(item);
      if (label === 'unverifiable' || !decision) return;
      score.scored += 1;
      if (label === 'incorrect') {
        score.incorrect += 1;
        if (decision === 'fail') score.incorrectFailed += 1;
        else if (decision === 'hold') score.incorrectHeld += 1;
        else score.incorrectPassed += 1;
      } else {
        score.correct += 1;
        if (decision === 'fail') score.correctFailed += 1;
        else if (decision === 'hold') score.correctHeld += 1;
        else score.correctPassed += 1;
      }
    });
    return score;
  });
}

/** Reads facts.csv: columns item, truth (correct | incorrect | unverifiable), note. */
export function parseFactsCsv(text: string): { truth: Map<string, FactTruth>; errors: string[] } {
  const rows = parseCsv(text);
  const truth = new Map<string, FactTruth>();
  const errors: string[] = [];
  if (rows.length === 0) return { truth, errors: ['facts sheet is empty'] };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const itemIndex = header.indexOf('item');
  const truthIndex = header.indexOf('truth');
  if (itemIndex < 0 || truthIndex < 0)
    return { truth, errors: ['facts sheet needs item and truth columns'] };
  for (const row of rows.slice(1)) {
    const item = (row[itemIndex] ?? '').trim();
    const value = (row[truthIndex] ?? '').trim().toLowerCase();
    if (!item) continue;
    if (value === 'correct' || value === 'incorrect' || value === 'unverifiable')
      truth.set(item, value);
    else if (value) errors.push(`${item}: truth must be correct, incorrect or unverifiable`);
  }
  return { truth, errors };
}

/** Guardian's verdict as a gate: its pipeline drops "fail", so "flag" is the closest to a hold. */
export function guardianDecision(verdict: GuardianVerdict | null): GateDecision | null {
  if (!verdict) return null;
  if (verdict.verdict === 'pass') return 'pass';
  if (verdict.verdict === 'fail') return 'fail';
  return 'hold';
}

export function ratingDecision(correct: YesNoUnsure): GateDecision {
  return correct === 'y' ? 'pass' : correct === 'n' ? 'fail' : 'hold';
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

const isRejected = (verdict: Verdict) => verdict !== 'keep';

export function computeReport(input: {
  candidatesFile: CandidatesFile;
  key: Record<string, BlindKeyEntry>;
  ratings: ParsedRatings;
  judge?: { model: string; ratings: Map<string, Rating> } | null;
  facts?: Map<string, FactTruth> | null;
  /** Evidence checker decisions keyed by blind item, from verify.json. */
  evidence?: Map<string, GateDecision> | null;
}): EvalReport {
  const { candidatesFile, key, ratings } = input;
  const armSpecs = armsOf(candidatesFile);
  const byCandidateId = new Map(candidatesFile.candidates.map((c) => [c.id, c]));
  const items = Object.entries(key).map(([item, entry]) => ({
    item,
    entry,
    candidate: byCandidateId.get(entry.candidateId) ?? null,
    rating: ratings.ratings.get(item) ?? null,
  }));

  const groupIds = [
    ...armSpecs.map((a) => a.id),
    ...(['library', 'planted'] as const).filter((g) =>
      Object.values(key).some((e) => e.group === g)
    ),
  ];
  const groups: GroupSummary[] = groupIds.map((group) => {
    const inGroup = items.filter((i) => i.entry.group === group);
    const rated = inGroup.filter((i) => i.rating).map((i) => ({ ...i, rating: i.rating! }));
    const keep = rated.filter((i) => i.rating.verdict === 'keep').length;
    return {
      group,
      total: inGroup.length,
      rated: rated.length,
      keep,
      fix: rated.filter((i) => i.rating.verdict === 'fix').length,
      drop: rated.filter((i) => i.rating.verdict === 'drop').length,
      keepInterval: wilsonInterval(keep, rated.length),
      incorrect: rated.filter((i) => i.rating.correct === 'n').length,
      unsure: rated.filter((i) => i.rating.correct === 'u').length,
      ambiguous: rated.filter((i) => i.rating.oneAnswer === 'n').length,
      notFitting: rated.filter((i) => i.rating.fits === 'n').length,
      funMean: mean(rated.map((i) => i.rating.fun)),
      difficultyMatches: rated.filter(
        (i) => i.candidate && i.candidate.question.difficulty === i.rating.difficulty
      ).length,
    };
  });

  const arms: ArmOperations[] = armSpecs.map(({ id: arm }) => {
    const stats = candidatesFile.stats.filter((s) => s.arm === arm);
    const kept = groups.find((g) => g.group === arm)!.keep;
    const costUsd = stats.reduce((sum, s) => sum + s.costUsd, 0);
    const gateCounts = stats.map((s) => s.droppedByGate);
    return {
      arm,
      requested: stats.reduce((sum, s) => sum + s.requested, 0),
      delivered: stats.reduce((sum, s) => sum + s.delivered, 0),
      errors: stats.filter((s) => s.error).length,
      droppedByGate: gateCounts.every((c) => c === null)
        ? null
        : gateCounts.reduce<number>((sum, c) => sum + (c ?? 0), 0),
      costUsd,
      latencyMs: stats.reduce((sum, s) => sum + s.latencyMs, 0),
      kept,
      costPerKeptUsd: kept > 0 ? costUsd / kept : null,
    };
  });

  const byTheme = candidatesFile.themes.flatMap((theme) =>
    armSpecs.map(({ id: arm }) => {
      const rated = items.filter(
        (i) => i.entry.group === arm && i.entry.themeId === theme.id && i.rating
      );
      return {
        themeId: theme.id,
        theme: theme.theme,
        arm,
        rated: rated.length,
        keep: rated.filter((i) => i.rating!.verdict === 'keep').length,
        funMean: mean(rated.map((i) => i.rating!.fun)),
      };
    })
  );

  const ratedGenerated = items.filter((i) => isArmGroup(i.entry.group, armSpecs) && i.rating);
  const guardianMisses = {
    ratedGenerated: ratedGenerated.length,
    passedButOwnerIncorrect: ratedGenerated.filter(
      (i) => i.rating!.correct === 'n' && i.candidate?.guardian?.verdict === 'pass'
    ).length,
  };

  let judge: JudgeAgreement | null = null;
  if (input.judge) {
    const judgeRatings = input.judge.ratings;
    const both = items
      .filter((i) => i.rating && judgeRatings.has(i.item))
      .map((i) => ({ ...i, owner: i.rating!, judged: judgeRatings.get(i.item)! }));
    const planted = items.filter((i) => i.entry.group === 'planted');
    judge = {
      compared: both.length,
      verdictAgreement:
        both.length > 0
          ? both.filter((b) => b.owner.verdict === b.judged.verdict).length / both.length
          : null,
      keepAgreement:
        both.length > 0
          ? both.filter((b) => isRejected(b.owner.verdict) === isRejected(b.judged.verdict))
              .length / both.length
          : null,
      keepKappa: cohenKappa(
        both.map(
          (b) => [isRejected(b.owner.verdict), isRejected(b.judged.verdict)] as [boolean, boolean]
        )
      ),
      ownerIncorrect: both.filter((b) => b.owner.correct === 'n').length,
      judgeCaughtIncorrect: both.filter((b) => b.owner.correct === 'n' && b.judged.correct === 'n')
        .length,
      judgeFalseIncorrect: both.filter((b) => b.owner.correct === 'y' && b.judged.correct === 'n')
        .length,
      funSpearman: spearman(
        both.map((b) => b.owner.fun),
        both.map((b) => b.judged.fun)
      ),
      plantedTotal: planted.length,
      plantedRejectedByOwner: planted.filter((i) => i.rating && isRejected(i.rating.verdict))
        .length,
      plantedRejectedByJudge: planted.filter(
        (i) => judgeRatings.has(i.item) && isRejected(judgeRatings.get(i.item)!.verdict)
      ).length,
      disagreements: both
        .filter((b) => isRejected(b.owner.verdict) !== isRejected(b.judged.verdict))
        .map((b) => ({
          item: b.item,
          owner: b.owner.verdict,
          judge: b.judged.verdict,
          judgeWhy: b.judged.why,
        })),
    };
  }

  let factChecks: FactCheckerScore[] | null = null;
  if (input.facts && input.facts.size > 0) {
    const decisions = (pick: (i: (typeof items)[number]) => GateDecision | null) =>
      new Map(
        items.flatMap((i) => {
          const d = pick(i);
          return d ? [[i.item, d] as [string, GateDecision]] : [];
        })
      );
    const checkers = [
      {
        name: "Guardian's fact check (model memory)",
        decisions: decisions((i) => guardianDecision(i.candidate?.guardian ?? null)),
      },
      ...(input.evidence
        ? [{ name: 'Evidence check (Wikipedia quote)', decisions: input.evidence }]
        : []),
      ...(input.judge
        ? [
            {
              name: `Judge (${input.judge.model})`,
              decisions: decisions((i) => {
                const r = input.judge!.ratings.get(i.item);
                return r ? ratingDecision(r.correct) : null;
              }),
            },
          ]
        : []),
      {
        name: 'Owner rating',
        decisions: decisions((i) => (i.rating ? ratingDecision(i.rating.correct) : null)),
      },
    ];
    factChecks = scoreFactCheckers(input.facts, checkers);
  }

  return {
    runId: candidatesFile.runId,
    generationModel: candidatesFile.generationModel,
    judgeModel: input.judge?.model ?? null,
    groups,
    arms,
    byTheme,
    guardianMisses,
    factChecks,
    armSpecs,
    judge,
    unrated: ratings.unrated,
    ratingErrors: ratings.errors,
  };
}

const pct = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 100)}%`);
const frac = (k: number, n: number) => (n === 0 ? 'n/a' : `${k}/${n} (${pct(k / n)})`);
const num = (value: number | null, digits = 2) => (value === null ? 'n/a' : value.toFixed(digits));

/**
 * Markdown summary: counts, rates and item IDs, plus the judge's one-line reasons for
 * disagreements. It never prints question text, but a judge reason may mention an answer, so
 * treat the report as answer-bearing (it lives in gitignored reports/).
 */
export function renderReportMarkdown(report: EvalReport): string {
  const lines: string[] = [];
  lines.push(`# Question eval results — run ${report.runId}`, '');
  lines.push(
    `Generation model: \`${report.generationModel}\`. Judge model: ${report.judgeModel ? `\`${report.judgeModel}\`` : 'not run'}.`,
    ''
  );
  if (report.ratingErrors.length > 0 || report.unrated.length > 0) {
    lines.push('## Sheet problems', '');
    if (report.unrated.length > 0)
      lines.push(`- Unrated items (${report.unrated.length}): ${report.unrated.join(', ')}`);
    for (const error of report.ratingErrors) lines.push(`- ${error}`);
    lines.push('');
  }

  lines.push('## Owner ratings by group', '');
  lines.push(
    '| Group | Rated | Keep (95% CI) | Fix | Drop | Incorrect | Unsure | Ambiguous | Off-brand | Fun (mean) | Difficulty label matched |'
  );
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const g of report.groups) {
    const ci = g.keepInterval ? ` (${pct(g.keepInterval.low)}–${pct(g.keepInterval.high)})` : '';
    lines.push(
      `| ${groupLabel(g.group, report.armSpecs)} | ${g.rated}/${g.total} | ${frac(g.keep, g.rated)}${ci} | ${g.fix} | ${g.drop} | ${frac(g.incorrect, g.rated)} | ${g.unsure} | ${frac(g.ambiguous, g.rated)} | ${frac(g.notFitting, g.rated)} | ${num(g.funMean)} | ${frac(g.difficultyMatches, g.rated)} |`
    );
  }
  lines.push('');

  lines.push('## Cost, yield and time by arm', '');
  lines.push(
    '| Arm | Delivered / requested | Dropped by QA gate | Failed theme runs | Cost (USD, upper bound) | Time | Kept by owner | Cost per kept question |'
  );
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const a of report.arms) {
    lines.push(
      `| ${groupLabel(a.arm, report.armSpecs)} | ${frac(a.delivered, a.requested)} | ${a.droppedByGate ?? 'not visible'} | ${a.errors} | $${a.costUsd.toFixed(4)} | ${(a.latencyMs / 1000).toFixed(0)}s | ${a.kept} | ${a.costPerKeptUsd === null ? 'n/a' : `$${a.costPerKeptUsd.toFixed(4)}`} |`
    );
  }
  lines.push('');

  lines.push('## Keep rate by theme', '');
  const armIds = report.armSpecs.map((a) => a.id);
  lines.push(`| Theme | ${armIds.map((id) => `${id} kept | ${id} fun`).join(' | ')} |`);
  lines.push(`|---|${armIds.map(() => '---|---|').join('')}`);
  const themeIds = Array.from(new Set(report.byTheme.map((t) => t.themeId)));
  for (const id of themeIds) {
    const cells = armIds.map((arm) => {
      const t = report.byTheme.find((x) => x.themeId === id && x.arm === arm);
      return t ? `${frac(t.keep, t.rated)} | ${num(t.funMean)}` : 'n/a | n/a';
    });
    const theme = report.byTheme.find((t) => t.themeId === id)!.theme;
    lines.push(`| ${theme} | ${cells.join(' | ')} |`);
  }
  lines.push('');

  if (report.factChecks) {
    lines.push('## Correctness checks against hand-verified facts', '');
    lines.push(
      'Truth labels come from `facts.csv`, checked by hand against sources. "Held" means the check would send the question for review instead of passing or rejecting it.',
      ''
    );
    lines.push(
      '| Check | Wrong answers rejected | Wrong answers held | Wrong answers passed | Correct answers rejected | Correct answers held | Correct answers passed |'
    );
    lines.push('|---|---|---|---|---|---|---|');
    for (const f of report.factChecks) {
      lines.push(
        `| ${f.checker} | ${f.incorrectFailed}/${f.incorrect} | ${f.incorrectHeld} | **${f.incorrectPassed}** | ${f.correctFailed}/${f.correct} | ${f.correctHeld} | ${f.correctPassed} |`
      );
    }
    lines.push('');
  }

  lines.push('## Built-in Guardian QA', '');
  lines.push(
    `Generated questions that Guardian's fact check passed but the owner marked incorrect: **${report.guardianMisses.passedButOwnerIncorrect}** of ${report.guardianMisses.ratedGenerated} rated.`,
    ''
  );

  if (report.judge) {
    const j = report.judge;
    lines.push('## Judge agreement with owner', '');
    lines.push(`- Items compared: ${j.compared}`);
    lines.push(`- Same verdict (keep / fix / drop): ${pct(j.verdictAgreement)}`);
    lines.push(
      `- Same keep-vs-reject decision: ${pct(j.keepAgreement)}; Cohen's kappa ${num(j.keepKappa)}`
    );
    lines.push(
      `- Owner-marked incorrect answers the judge also caught: ${j.judgeCaughtIncorrect}/${j.ownerIncorrect}`
    );
    lines.push(`- Judge marked incorrect where the owner said correct: ${j.judgeFalseIncorrect}`);
    lines.push(`- Fun ranking correlation (Spearman): ${num(j.funSpearman)}`);
    lines.push(
      `- Planted bad questions rejected: owner ${j.plantedRejectedByOwner}/${j.plantedTotal}, judge ${j.plantedRejectedByJudge}/${j.plantedTotal}`,
      ''
    );
    if (j.disagreements.length > 0) {
      lines.push('### Keep-vs-reject disagreements', '');
      lines.push('| Item | Owner | Judge | Judge reason |');
      lines.push('|---|---|---|---|');
      for (const d of j.disagreements)
        lines.push(`| ${d.item} | ${d.owner} | ${d.judge} | ${d.judgeWhy.replace(/\|/g, '/')} |`);
      lines.push('');
    }
  }

  lines.push(
    '## Reading these numbers',
    '',
    'With roughly 20–25 rated items per arm, only large differences are meaningful: check whether the confidence intervals overlap before drawing conclusions. Apply the decision rules in `docs/guides/question_eval.md`, which were written before any results were seen.',
    ''
  );
  return lines.join('\n');
}
