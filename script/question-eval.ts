/**
 * Offline question-quality eval (STE-304). Development-time only; no database or production calls.
 *
 *   npm run eval:questions -- generate --dry-run       # show the plan and spend cap, no calls
 *   npm run eval:questions -- generate [--max-usd 3]   # generate both arms + blind review sheet
 *   npm run eval:questions -- judge [--run <dir>]      # LLM judge over the same blind sheet
 *   npm run eval:questions -- score [--run <dir>]      # owner ratings (+ judge) -> report.md
 *
 * Needs AI_INTEGRATIONS_OPENAI_API_KEY (any placeholder value in a Claude Code cloud session,
 * where the proxy injects the real key). See docs/guides/question_eval.md.
 *
 * Output goes to reports/question-eval/<runId>/ (gitignored). The review sheet and candidates
 * file contain answers: do not commit or paste them anywhere public.
 */
import { existsSync } from 'fs';
import { mkdir, readdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import OpenAI from 'openai';

import { TRIVIA_AI_REQUEST_CONFIG } from '../server/lib/ai-model-config';
import { generateQuestions } from '../server/lib/guardian';
import { auditQuestionQuality } from '../server/lib/question-quality-audit';
import { batchFactCheck } from '../server/lib/verifier';
import {
  QUESTION_EVAL_SCHEMA_VERSION,
  SpendLimitError,
  SpendTracker,
  WIKIPEDIA_USER_AGENT,
  buildBlindSheet,
  buildGroundedPrompt,
  buildJudgePrompt,
  buildWikipediaExtractUrl,
  buildWikipediaSearchUrl,
  cleanWikipediaExtract,
  computeReport,
  extractUsage,
  failedPairs,
  mergeRetriedGeneration,
  normalizeGeneratedQuestion,
  parseJudgeResponse,
  parseRatingsCsv,
  priceForModel,
  renderReportMarkdown,
  runGeneration,
  seedFromString,
  type ArmOutput,
  type BlindKeyEntry,
  type Candidate,
  type CandidatesFile,
  type EvalPillar,
  type EvalQuestion,
  type EvalTheme,
  type GroundingArticle,
  type GuardianVerdict,
  type Rating,
} from '../server/lib/question-eval';
import type { Question } from '../shared/models/questions';

const CONFIG_PATH = 'test/fixtures/question-eval/config.json';
const REPORTS_ROOT = 'reports/question-eval';
const ARTICLES_PER_THEME = 3;
const MAX_ARTICLE_CHARS = 6_000;
const JUDGE_BATCH_SIZE = 8;

interface EvalConfig {
  questionsPerThemePerArm: number;
  generationModel: string;
  judgeModel: string;
  themes: EvalTheme[];
  libraryAnchors: { source: string; ids: string[] };
  plantedBad: { source: string; ids: string[] };
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const [command, ...rest] = argv;
  const flags = new Map<string, string | true>();
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (!arg.startsWith('--')) continue;
    const [name, inline] = arg.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (rest[i + 1] && !rest[i + 1].startsWith('--')) flags.set(name, rest[++i]);
    else flags.set(name, true);
  }
  return { command, flags };
}

function flagString(flags: Map<string, string | true>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === 'string' ? value : undefined;
}

// ---------------------------------------------------------------------------
// Network with spend accounting
// ---------------------------------------------------------------------------

/**
 * Wraps global fetch so every OpenAI response, including Guardian's internal calls, is charged to
 * the tracker, and no request is sent once the cap is reached. Must be installed before Guardian
 * creates its client, because the SDK captures the fetch function at construction.
 */
function installSpendTracking(tracker: SpendTracker): void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!url.startsWith('https://api.openai.com/')) return originalFetch(input, init);
    tracker.assertWithinLimit();
    let model = 'unknown';
    try {
      model = (JSON.parse(String(init?.body ?? '{}')) as { model?: string }).model ?? 'unknown';
    } catch {
      // non-JSON body (not used by these calls)
    }
    const response = await originalFetch(input, init);
    try {
      const usage = extractUsage(await response.clone().json());
      if (usage) tracker.record(model, usage.input, usage.output);
    } catch {
      // error bodies and non-JSON responses carry no usage
    }
    return response;
  };
}

async function wikipediaJson(url: string): Promise<unknown> {
  // Wikipedia rate-limits unauthenticated clients, sometimes for a minute or more when the
  // outbound address is shared. Back off patiently (about 90 seconds worst case) and honour
  // Retry-After when it is sent.
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await fetch(url, {
      headers: { 'User-Agent': WIKIPEDIA_USER_AGENT, Accept: 'application/json' },
    });
    if (response.status === 429 || response.status >= 500) {
      const retryAfterSeconds = Number(response.headers.get('retry-after'));
      const waitMs =
        Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
          ? Math.min(retryAfterSeconds * 1_000, 60_000)
          : 3_000 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    if (!response.ok) throw new Error(`Wikipedia returned HTTP ${response.status}`);
    // Be polite: Wikipedia rate-limits bursts from unauthenticated clients.
    await new Promise((r) => setTimeout(r, 500));
    return response.json();
  }
  throw new Error('Wikipedia kept rate-limiting the request');
}

async function fetchGrounding(
  theme: EvalTheme
): Promise<Array<{ title: string; url: string; text: string }>> {
  const search = (await wikipediaJson(
    buildWikipediaSearchUrl(theme.theme, ARTICLES_PER_THEME + 2)
  )) as {
    query?: { search?: Array<{ title: string }> };
  };
  const titles = (search.query?.search ?? []).map((r) => r.title);
  const articles: Array<{ title: string; url: string; text: string }> = [];
  for (const title of titles) {
    if (articles.length >= ARTICLES_PER_THEME) break;
    const page = (await wikipediaJson(buildWikipediaExtractUrl(title))) as {
      query?: {
        pages?: Array<{ title?: string; extract?: string; fullurl?: string; missing?: boolean }>;
      };
    };
    const first = page.query?.pages?.[0];
    if (!first || first.missing || !first.extract || !first.fullurl) continue;
    const text = cleanWikipediaExtract(first.extract, MAX_ARTICLE_CHARS);
    if (text.length < 500) continue; // stubs and disambiguation pages
    articles.push({ title: first.title ?? title, url: first.fullurl, text });
  }
  if (articles.length === 0) throw new Error('no usable Wikipedia articles found');
  return articles;
}

// ---------------------------------------------------------------------------
// Arms
// ---------------------------------------------------------------------------

function guardianVerdictOf(analysis: unknown): GuardianVerdict | null {
  const a = analysis as
    | {
        factCheck?: {
          verdict?: string;
          coherence?: string;
          obviousness?: string;
          confidence?: number;
        };
        qaFindings?: Array<{ severity?: string }>;
        repaired?: boolean;
      }
    | undefined;
  if (!a?.factCheck) return null;
  return {
    verdict: a.factCheck.verdict ?? 'unknown',
    coherence: a.factCheck.coherence ?? 'unknown',
    obviousness: a.factCheck.obviousness ?? 'unknown',
    confidence: typeof a.factCheck.confidence === 'number' ? a.factCheck.confidence : null,
    highFindings: (a.qaFindings ?? []).filter((f) => f.severity === 'high').length,
    repaired: a.repaired === true,
  };
}

/** Arm A: the existing staging generator, called exactly as /api/staging/generate calls it. */
async function generateArmA(theme: EvalTheme, count: number): Promise<ArmOutput> {
  const generated = await generateQuestions(theme.theme, count, theme.pillar);
  const questions = generated.flatMap((q) => {
    const normalized = normalizeGeneratedQuestion(q, theme.pillar);
    return normalized ? [{ question: normalized, guardian: guardianVerdictOf(q.aiAnalysis) }] : [];
  });
  return { questions, droppedByGate: null };
}

function toAuditable(id: string, q: EvalQuestion) {
  return {
    id,
    category: q.category,
    difficulty: q.difficulty,
    question: q.question,
    answer: q.answer,
    acceptableAnswers: q.acceptableAnswers,
    explanation: q.explanation,
    pillar: q.pillar,
    tags: [q.region, q.pillar, q.category],
    sourceUrl: q.sourceUrl,
    sourceName: q.sourceName,
  };
}

/**
 * Arm B: one generation call grounded in Wikipedia text, then Guardian's own QA gate (static
 * audit + LLM fact check, hard failures dropped). Unlike arm A it has no repair pass.
 */
function createArmB(openai: OpenAI) {
  return async (theme: EvalTheme, count: number): Promise<ArmOutput> => {
    const articles = await fetchGrounding(theme);
    const grounding: GroundingArticle[] = articles.map((a) => ({
      title: a.title,
      url: a.url,
      characters: a.text.length,
    }));
    const response = await openai.chat.completions.create({
      ...TRIVIA_AI_REQUEST_CONFIG,
      messages: [
        {
          role: 'system',
          content:
            'You write party trivia from supplied source text. Always return valid JSON that matches the requested schema.',
        },
        { role: 'user', content: buildGroundedPrompt(theme, count, articles) },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 4096,
    });
    const parsed = JSON.parse(response.choices[0]?.message?.content || '{}') as {
      questions?: unknown[];
    };
    const raw = Array.isArray(parsed.questions) ? parsed.questions.slice(0, count) : [];
    const normalized = raw
      .map((item) => normalizeGeneratedQuestion(item, theme.pillar as EvalPillar))
      .filter((q): q is EvalQuestion => q !== null)
      .map((q, index) => ({ id: `B-${theme.id}-${index + 1}`, q }));

    const auditable = normalized.map(({ id, q }) => toAuditable(id, q));
    const [audit, factCheck] = await Promise.all([
      Promise.resolve(auditQuestionQuality(auditable)),
      normalized.length > 0
        ? batchFactCheck(auditable as unknown as Question[])
        : Promise.resolve({ totalChecked: 0, results: [] }),
    ]);

    const questions = normalized.flatMap(({ id, q }) => {
      const verdict = factCheck.results.find((r) => r.questionId === id);
      const highFindings = audit.findings.filter(
        (f) => f.questionId === id && f.severity === 'high'
      );
      // Same hard-failure rule as Guardian's isHardFailure(). A missing verdict counts as "flag".
      if (verdict?.verdict === 'fail' || highFindings.length > 0) return [];
      return [
        {
          question: q,
          guardian: guardianVerdictOf({
            factCheck: verdict ?? { verdict: 'flag' },
            qaFindings: highFindings,
          }),
        },
      ];
    });
    return { questions, droppedByGate: count - questions.length, grounding };
  };
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

async function loadAnchors(config: EvalConfig): Promise<Candidate[]> {
  const library = JSON.parse(await readFile(config.libraryAnchors.source, 'utf8')) as Array<
    Record<string, unknown>
  >;
  const cases = JSON.parse(await readFile(config.plantedBad.source, 'utf8')) as Array<{
    id: string;
    question: Record<string, unknown>;
  }>;
  const anchors: Candidate[] = [];
  const add = (
    group: 'library' | 'planted',
    id: string,
    raw: Record<string, unknown> | undefined
  ) => {
    if (!raw) throw new Error(`${group} anchor "${id}" not found`);
    const pillar = (raw.pillar as EvalPillar) ?? 'GlobalEh';
    const question = normalizeGeneratedQuestion(
      { ...raw, sourceUrl: raw.sourceUrl || 'https://en.wikipedia.org/' },
      pillar
    );
    if (!question) throw new Error(`${group} anchor "${id}" is missing required fields`);
    anchors.push({
      id: `${group}-${id}`,
      group,
      themeId: null,
      theme: String(raw.category ?? 'General'),
      question,
      guardian: null,
    });
  };
  for (const id of config.libraryAnchors.ids)
    add(
      'library',
      id,
      library.find((q) => q.id === id)
    );
  for (const id of config.plantedBad.ids)
    add('planted', id, cases.find((c) => c.id === id)?.question);
  return anchors;
}

// ---------------------------------------------------------------------------
// Run directories
// ---------------------------------------------------------------------------

async function resolveRunDir(flags: Map<string, string | true>): Promise<string> {
  const explicit = flagString(flags, 'run');
  if (explicit) return explicit;
  if (!existsSync(REPORTS_ROOT))
    throw new Error(`No runs yet in ${REPORTS_ROOT}. Run "generate" first.`);
  const runs = (await readdir(REPORTS_ROOT)).filter((name) =>
    existsSync(path.join(REPORTS_ROOT, name, 'candidates.json'))
  );
  if (runs.length === 0) throw new Error(`No runs yet in ${REPORTS_ROOT}. Run "generate" first.`);
  return path.join(REPORTS_ROOT, runs.sort().at(-1)!);
}

async function writePrivate(file: string, content: string): Promise<void> {
  await writeFile(file, content, { encoding: 'utf8', mode: 0o600 });
}

function requireKeyVariable(): void {
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      'AI_INTEGRATIONS_OPENAI_API_KEY is not set. Locally, use a separately capped key. In a Claude Code cloud session, set it to any placeholder (the proxy injects the real key).'
    );
  }
}

function requirePrice(model: string): void {
  if (!priceForModel(model)) {
    throw new Error(
      `No price configured for "${model}". Add it to MODEL_PRICES_PER_MILLION so the spend cap works.`
    );
  }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function commandGenerate(
  config: EvalConfig,
  flags: Map<string, string | true>
): Promise<void> {
  const maxUsd = Number(flagString(flags, 'max-usd') ?? '3');
  const count = config.questionsPerThemePerArm;
  const anchors = await loadAnchors(config);
  requirePrice(config.generationModel);
  if (config.generationModel !== TRIVIA_AI_REQUEST_CONFIG.model) {
    throw new Error(
      `Config generationModel "${config.generationModel}" differs from Guardian's "${TRIVIA_AI_REQUEST_CONFIG.model}"; arm A would not match production.`
    );
  }

  console.log(`Themes: ${config.themes.length} | questions per theme per arm: ${count}`);
  console.log(
    `Requested: ${config.themes.length * count * 2} generated + ${anchors.length} anchors`
  );
  console.log(`Generation model: ${config.generationModel} | spend cap: $${maxUsd.toFixed(2)}`);
  if (flags.get('dry-run')) {
    console.log('Dry run: no requests made.');
    return;
  }
  requireKeyVariable();

  const tracker = new SpendTracker(maxUsd);
  installSpendTracking(tracker);
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, maxRetries: 1 });
  const deps = {
    generateArmA,
    generateArmB: createArmB(openai),
    now: Date.now,
    log: (m: string) => console.log(m),
  };

  if (flags.get('retry-failed')) {
    const runDir = await resolveRunDir(flags);
    const previous = JSON.parse(
      await readFile(path.join(runDir, 'candidates.json'), 'utf8')
    ) as CandidatesFile;
    if (existsSync(path.join(runDir, 'ratings.csv'))) {
      throw new Error('This run already has ratings.csv; retrying would reshuffle a rated sheet.');
    }
    const failed = failedPairs(previous);
    if (failed.length === 0) {
      console.log('No failed arm/theme pairs to retry.');
      return;
    }
    console.log(`Retrying ${failed.map((f) => `${f.arm}:${f.themeId}`).join(', ')} in ${runDir}`);
    const retried = await runGeneration(
      previous.themes,
      previous.questionsPerThemePerArm,
      deps,
      tracker,
      (arm, themeId) => failed.some((f) => f.arm === arm && f.themeId === themeId)
    );
    const merged = mergeRetriedGeneration(previous, retried);
    // Same seed as the original run, so the sheet is reproducible from the run ID.
    const sheet = buildBlindSheet(merged.candidates, seedFromString(merged.runId));
    await writePrivate(path.join(runDir, 'candidates.json'), JSON.stringify(merged, null, 2));
    await writePrivate(path.join(runDir, 'key.json'), JSON.stringify(sheet.key, null, 2));
    await writePrivate(path.join(runDir, 'review-sheet.csv'), sheet.csv);
    const stillFailed = failedPairs(merged);
    console.log(`\nSpent this retry: $${tracker.totalUsd.toFixed(4)}`);
    console.log(
      `Review sheet now has ${Object.keys(sheet.key).length} items.` +
        (stillFailed.length > 0
          ? ` Still failed: ${stillFailed.map((f) => `${f.arm}:${f.themeId}`).join(', ')}`
          : ' No failed pairs remain.')
    );
    return;
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(REPORTS_ROOT, runId);
  await mkdir(runDir, { recursive: true });

  let generated: Awaited<ReturnType<typeof runGeneration>>;
  try {
    generated = await runGeneration(config.themes, count, deps, tracker);
  } catch (error) {
    if (error instanceof SpendLimitError) console.error(error.message);
    throw error;
  }

  const candidatesFile: CandidatesFile = {
    schemaVersion: QUESTION_EVAL_SCHEMA_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    generationModel: config.generationModel,
    questionsPerThemePerArm: count,
    themes: config.themes,
    candidates: [...generated.candidates, ...anchors],
    stats: generated.stats,
    grounding: generated.grounding,
  };
  const sheet = buildBlindSheet(candidatesFile.candidates, seedFromString(runId));
  await writePrivate(path.join(runDir, 'candidates.json'), JSON.stringify(candidatesFile, null, 2));
  await writePrivate(path.join(runDir, 'key.json'), JSON.stringify(sheet.key, null, 2));
  await writePrivate(path.join(runDir, 'review-sheet.csv'), sheet.csv);

  console.log(`\nSpent: $${tracker.totalUsd.toFixed(4)} over ${tracker.requests} OpenAI requests`);
  console.log(
    `Review sheet (${Object.keys(sheet.key).length} items): ${path.join(runDir, 'review-sheet.csv')}`
  );
  console.log(
    'Copy it to ratings.csv in the same folder, fill in the rating columns, then run "score".'
  );
}

async function commandJudge(config: EvalConfig, flags: Map<string, string | true>): Promise<void> {
  const runDir = await resolveRunDir(flags);
  const model = flagString(flags, 'model') ?? config.judgeModel;
  const maxUsd = Number(flagString(flags, 'max-usd') ?? '2');
  requirePrice(model);
  const candidatesFile = JSON.parse(
    await readFile(path.join(runDir, 'candidates.json'), 'utf8')
  ) as CandidatesFile;
  const key = JSON.parse(await readFile(path.join(runDir, 'key.json'), 'utf8')) as Record<
    string,
    BlindKeyEntry
  >;
  const byId = new Map(candidatesFile.candidates.map((c) => [c.id, c]));
  const items = Object.entries(key).map(([item, entry]) => {
    const candidate = byId.get(entry.candidateId)!;
    return { item, theme: candidate.theme, question: candidate.question };
  });
  console.log(`Judging ${items.length} items with ${model} | spend cap: $${maxUsd.toFixed(2)}`);
  if (flags.get('dry-run')) {
    console.log('Dry run: no requests made.');
    return;
  }
  requireKeyVariable();

  const tracker = new SpendTracker(maxUsd);
  installSpendTracking(tracker);
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, maxRetries: 1 });
  const ratings: Record<string, Rating> = {};
  const problems: string[] = [];
  for (let i = 0; i < items.length; i += JUDGE_BATCH_SIZE) {
    const batch = items.slice(i, i + JUDGE_BATCH_SIZE);
    const response = await openai.responses.create({
      model,
      reasoning: { effort: 'medium' },
      input: buildJudgePrompt(batch),
      text: { format: { type: 'json_object' } },
      max_output_tokens: 8_000,
    });
    const parsed = parseJudgeResponse(
      response.output_text ?? '',
      batch.map((b) => b.item)
    );
    parsed.ratings.forEach((rating, item) => (ratings[item] = rating));
    problems.push(...parsed.problems);
    console.log(
      `  ${Math.min(i + JUDGE_BATCH_SIZE, items.length)}/${items.length} | $${tracker.totalUsd.toFixed(4)}`
    );
  }
  await writePrivate(
    path.join(runDir, 'judge.json'),
    JSON.stringify(
      { model, createdAt: new Date().toISOString(), costUsd: tracker.totalUsd, problems, ratings },
      null,
      2
    )
  );
  console.log(
    `Judge done: ${Object.keys(ratings).length} rated, ${problems.length} problems, $${tracker.totalUsd.toFixed(4)}`
  );
}

async function commandScore(flags: Map<string, string | true>): Promise<void> {
  const runDir = await resolveRunDir(flags);
  const ratingsPath = flagString(flags, 'ratings') ?? path.join(runDir, 'ratings.csv');
  if (!existsSync(ratingsPath)) {
    throw new Error(
      `No ratings file at ${ratingsPath}. Copy review-sheet.csv to ratings.csv and fill it in.`
    );
  }
  const candidatesFile = JSON.parse(
    await readFile(path.join(runDir, 'candidates.json'), 'utf8')
  ) as CandidatesFile;
  const key = JSON.parse(await readFile(path.join(runDir, 'key.json'), 'utf8')) as Record<
    string,
    BlindKeyEntry
  >;
  const ratings = parseRatingsCsv(await readFile(ratingsPath, 'utf8'), key);
  const judgePath = path.join(runDir, 'judge.json');
  let judge: { model: string; ratings: Map<string, Rating> } | null = null;
  if (existsSync(judgePath)) {
    const data = JSON.parse(await readFile(judgePath, 'utf8')) as {
      model: string;
      ratings: Record<string, Rating>;
    };
    judge = { model: data.model, ratings: new Map(Object.entries(data.ratings)) };
  }
  const report = computeReport({ candidatesFile, key, ratings, judge });
  await writePrivate(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  await writePrivate(path.join(runDir, 'report.md'), renderReportMarkdown(report));
  console.log(
    `Rated ${ratings.ratings.size}/${Object.keys(key).length}; ${ratings.errors.length} sheet problems.`
  );
  for (const error of ratings.errors) console.log(`  - ${error}`);
  console.log(`Report: ${path.join(runDir, 'report.md')}`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const config = JSON.parse(await readFile(CONFIG_PATH, 'utf8')) as EvalConfig;
  if (command === 'generate') await commandGenerate(config, flags);
  else if (command === 'judge') await commandJudge(config, flags);
  else if (command === 'score') await commandScore(flags);
  else {
    console.log(
      'Usage: npm run eval:questions -- <generate|judge|score> [--dry-run] [--run <dir>] [--max-usd <n>]'
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('question-eval failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
