/**
 * Offline question-quality eval (STE-304). Development-time only; no database or production calls.
 *
 *   npm run eval:questions -- generate --dry-run        # show the plan and spend cap, no calls
 *   npm run eval:questions -- generate [--max-usd 3]    # generate every arm + blind review sheet
 *   npm run eval:questions -- judge [--rubric v1|v2]    # LLM judge over the same blind sheet
 *   npm run eval:questions -- verify                    # Wikipedia evidence check per item
 *   npm run eval:questions -- repeats                   # repeats across simulated games
 *   npm run eval:questions -- rating-page               # owner rating page HTML for the run
 *   npm run eval:questions -- import-ratings --from <dir>  # rating page export -> ratings.csv
 *   npm run eval:questions -- score                     # ratings (+ judge, facts) -> report.md
 *
 * Every command takes --config <file> (default: round 1 config) and --run <dir> (default: the
 * latest run).
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
import {
  JUDGE_CALIBRATION_V2,
  JUDGE_CALIBRATION_V3,
  WRITER_STYLE_GUIDE_V2,
} from '../server/lib/trivia-style-guide';
import { batchFactCheck } from '../server/lib/verifier';
import {
  QUESTION_EVAL_SCHEMA_VERSION,
  ROUND_1_ARMS,
  RATING_COLUMNS,
  armsOf,
  buildEvidenceQueryPrompt,
  buildEvidenceVerdictPrompt,
  parseEvidenceQueries,
  parseEvidenceVerdict,
  parseFactsCsv,
  selectPassages,
  toCsv,
  type ArmSpec,
  type EvidenceResult,
  type GateDecision,
  type ThemeBrief,
  buildRepeatCheckPrompt,
  buildThemeBriefPrompt,
  filterRepeatedAnswers,
  parseRepeatCheck,
  parseThemeBrief,
  themeBriefGuidance,
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

const DEFAULT_CONFIG_PATH = 'test/fixtures/question-eval/config.json';
const RATING_PAGE_TEMPLATE = 'script/question-eval-rating-page.html';
const EVIDENCE_PASSAGE_CHARS = 2_500;
const EVIDENCE_ARTICLES = 3;
const REPORTS_ROOT = 'reports/question-eval';
const ARTICLES_PER_THEME = 3;
const MAX_ARTICLE_CHARS = 6_000;
const JUDGE_BATCH_SIZE = 8;

interface EvalConfig {
  questionsPerThemePerArm: number;
  generationModel: string;
  judgeModel: string;
  /** Strong model for the evidence check's verdict; defaults to judgeModel. */
  verifyModel?: string;
  /** Simulated games per theme and arm (default 1). Only game 1 is rated by the owner. */
  gamesPerTheme?: number;
  /** Arms for this round; round 1 configs omit it (A and B). */
  arms?: ArmSpec[];
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

/**
 * A Guardian arm: the existing staging generator, called as /api/staging/generate calls it,
 * optionally with a style guide.
 */
async function generateGuardian(
  spec: ArmSpec,
  theme: EvalTheme,
  count: number
): Promise<ArmOutput> {
  const options = spec.styleGuide === 'v2' ? { styleGuide: WRITER_STYLE_GUIDE_V2 } : {};
  const generated = await generateQuestions(theme.theme, count, theme.pillar, [], options);
  const questions = generated.flatMap((q) => {
    const normalized = normalizeGeneratedQuestion(q, theme.pillar);
    return normalized ? [{ question: normalized, guardian: guardianVerdictOf(q.aiAnalysis) }] : [];
  });
  return { questions, droppedByGate: null };
}

/** Theme briefs are made once per theme and shared by every game of the themed arm. */
const themeBriefs = new Map<string, ThemeBrief>();

async function themeBriefFor(openai: OpenAI, theme: EvalTheme): Promise<ThemeBrief> {
  const cached = themeBriefs.get(theme.id);
  if (cached) return cached;
  const response = await openai.chat.completions.create({
    ...TRIVIA_AI_REQUEST_CONFIG,
    messages: [{ role: 'user', content: buildThemeBriefPrompt(theme.theme) }],
    response_format: { type: 'json_object' },
    max_completion_tokens: 800,
  });
  const brief = parseThemeBrief(response.choices[0]?.message?.content ?? '', theme.theme);
  themeBriefs.set(theme.id, brief);
  return brief;
}

/**
 * The themed arm: a theme brief (breadth check, widening narrow themes, focus subtopics), then
 * Guardian with the brief and this theme's earlier questions as history, then a deterministic
 * filter that drops any question reusing an earlier answer.
 */
async function generateThemed(
  openai: OpenAI,
  theme: EvalTheme,
  count: number,
  history: EvalQuestion[]
): Promise<ArmOutput> {
  const brief = await themeBriefFor(openai, theme);
  const generated = await generateQuestions(
    brief.generationTheme,
    count,
    theme.pillar,
    history.map((q) => ({ question: q.question, answer: q.answer })),
    { styleGuide: themeBriefGuidance(brief) }
  );
  const questions = generated.flatMap((q) => {
    const normalized = normalizeGeneratedQuestion(q, theme.pillar);
    return normalized ? [{ question: normalized, guardian: guardianVerdictOf(q.aiAnalysis) }] : [];
  });
  const { kept, dropped } = filterRepeatedAnswers(questions, history);
  return { questions: kept, droppedByGate: dropped };
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
  const arms = config.arms && config.arms.length > 0 ? config.arms : ROUND_1_ARMS;
  const anchors = await loadAnchors(config);
  requirePrice(config.generationModel);
  if (config.generationModel !== TRIVIA_AI_REQUEST_CONFIG.model) {
    throw new Error(
      `Config generationModel "${config.generationModel}" differs from Guardian's "${TRIVIA_AI_REQUEST_CONFIG.model}"; arm A would not match production.`
    );
  }

  const plannedGames = config.gamesPerTheme ?? 1;
  const perGame = config.themes.length * count * arms.length;
  console.log(
    `Themes: ${config.themes.length} | questions per theme per arm per game: ${count} | games: ${plannedGames}`
  );
  console.log(
    `Requested: ${perGame * plannedGames} generated (${perGame} rated from game 1) + ${anchors.length} anchors`
  );
  console.log(`Arms: ${arms.map((a) => a.label).join(' | ')}`);
  console.log(`Generation model: ${config.generationModel} | spend cap: $${maxUsd.toFixed(2)}`);
  if (flags.get('dry-run')) {
    console.log('Dry run: no requests made.');
    return;
  }
  requireKeyVariable();

  const tracker = new SpendTracker(maxUsd);
  installSpendTracking(tracker);
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, maxRetries: 1 });
  const groundedArm = createArmB(openai);
  const games = config.gamesPerTheme ?? 1;
  const deps = {
    generate: (spec: ArmSpec, theme: EvalTheme, n: number, history: EvalQuestion[]) =>
      spec.generator === 'guardian-wikipedia'
        ? groundedArm(theme, n)
        : spec.generator === 'guardian-themed'
          ? generateThemed(openai, theme, n, history)
          : generateGuardian(spec, theme, n),
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
      armsOf(previous),
      previous.questionsPerThemePerArm,
      deps,
      tracker,
      {
        only: (arm, themeId) => failed.some((f) => f.arm === arm && f.themeId === themeId),
        games: previous.gamesPerTheme ?? 1,
      }
    );
    const merged = mergeRetriedGeneration(previous, retried);
    // Same seed as the original run, so the sheet is reproducible from the run ID.
    const sheet = buildBlindSheet(ratedCandidates(merged.candidates), seedFromString(merged.runId));
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
    generated = await runGeneration(config.themes, arms, count, deps, tracker, { games });
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
    ...(games > 1 ? { gamesPerTheme: games } : {}),
    ...(themeBriefs.size > 0 ? { themeBriefs: Object.fromEntries(themeBriefs) } : {}),
    arms,
    themes: config.themes,
    candidates: [...generated.candidates, ...anchors],
    stats: generated.stats,
    grounding: generated.grounding,
  };
  const sheet = buildBlindSheet(ratedCandidates(candidatesFile.candidates), seedFromString(runId));
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
  const rubric = flagString(flags, 'rubric') ?? 'v1';
  if (rubric !== 'v1' && rubric !== 'v2' && rubric !== 'v3')
    throw new Error('--rubric must be v1, v2 or v3');
  const calibration =
    rubric === 'v3' ? JUDGE_CALIBRATION_V3 : rubric === 'v2' ? JUDGE_CALIBRATION_V2 : undefined;
  const outFile = rubric === 'v1' ? 'judge.json' : `judge-${rubric}.json`;
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
  console.log(
    `Judging ${items.length} items with ${model}, rubric ${rubric} | spend cap: $${maxUsd.toFixed(2)}`
  );
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
      input: buildJudgePrompt(batch, calibration),
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
    path.join(runDir, outFile),
    JSON.stringify(
      {
        model,
        rubric,
        createdAt: new Date().toISOString(),
        costUsd: tracker.totalUsd,
        problems,
        ratings,
      },
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

  // Every judge file in the run (judge.json = rubric v1, judge-v2.json = rubric v2, ...).
  // Sorted by rubric version (judge.json is v1), so the newest rubric is last and is the default.
  const rubricVersion = (f: string) => Number(/^judge-v(\d+)\.json$/.exec(f)?.[1] ?? 1);
  const judgeFiles = (await readdir(runDir))
    .filter((f) => /^judge(-v\d+)?\.json$/.test(f))
    .sort((a, b) => rubricVersion(a) - rubricVersion(b));
  const judges = await Promise.all(
    judgeFiles.map(async (file) => {
      const data = JSON.parse(await readFile(path.join(runDir, file), 'utf8')) as {
        model: string;
        rubric?: string;
        ratings: Record<string, Rating>;
      };
      return {
        file,
        model: `${data.model}, rubric ${data.rubric ?? 'v1'}`,
        ratings: new Map(Object.entries(data.ratings)),
      };
    })
  );
  const primaryFile = flagString(flags, 'judge') ?? judgeFiles.at(-1);
  const primary = judges.find((j) => j.file === primaryFile) ?? null;

  const factsPath = path.join(runDir, 'facts.csv');
  const facts = existsSync(factsPath) ? parseFactsCsv(await readFile(factsPath, 'utf8')) : null;
  const verifyPath = path.join(runDir, 'verify.json');
  const evidence = existsSync(verifyPath)
    ? new Map(
        Object.entries(
          (
            JSON.parse(await readFile(verifyPath, 'utf8')) as {
              results: Record<string, { decision: GateDecision }>;
            }
          ).results
        ).map(([item, r]) => [item, r.decision])
      )
    : null;

  const report = computeReport({
    candidatesFile,
    key,
    ratings,
    judge: primary,
    facts: facts?.truth ?? null,
    evidence,
  });
  let markdown = renderReportMarkdown(report);
  if (judges.length > 1) {
    const rows = judges.map((j) => {
      const a = computeReport({ candidatesFile, key, ratings, judge: j }).judge!;
      const fmt = (v: number | null, pctg = true) =>
        v === null ? 'n/a' : pctg ? `${Math.round(v * 100)}%` : v.toFixed(2);
      return `| ${j.model} | ${fmt(a.keepAgreement)} | ${fmt(a.keepKappa, false)} | ${fmt(a.funSpearman, false)} | ${a.plantedRejectedByJudge}/${a.plantedTotal} |`;
    });
    markdown += [
      '',
      '## Judge versions compared',
      '',
      '| Judge | Same keep-vs-reject as owner | Kappa | Fun Spearman | Planted rejected |',
      '|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n');
  }
  await writePrivate(path.join(runDir, 'report.json'), JSON.stringify(report, null, 2));
  const repeatsPath = path.join(runDir, 'repeats.json');
  if (existsSync(repeatsPath)) {
    const data = JSON.parse(await readFile(repeatsPath, 'utf8')) as {
      results: Array<{
        arm: string;
        themeId: string;
        game: number;
        later: number;
        repeats: unknown[];
      }>;
    };
    const filtered = candidatesFile.stats.filter((st) => (st.game ?? 1) > 1);
    const rows = armsOf(candidatesFile).map((spec) => {
      const mine = data.results.filter((r) => r.arm === spec.id);
      const later = mine.reduce((sum, r) => sum + r.later, 0);
      const repeats = mine.reduce((sum, r) => sum + r.repeats.length, 0);
      const dropped = filtered
        .filter((st) => st.arm === spec.id)
        .reduce<number | null>(
          (sum, st) => (st.droppedByGate === null ? sum : (sum ?? 0) + st.droppedByGate),
          null
        );
      const rate = later > 0 ? `${Math.round((repeats / later) * 100)}%` : 'n/a';
      return `| ${spec.label} | ${later} | ${repeats} (${rate}) | ${dropped ?? 'not filtered'} |`;
    });
    markdown += [
      '',
      '## Repeats in later games',
      '',
      'Each theme was generated for several simulated games. A repeat is a later-game question that tests the same fact as an earlier game for the same theme and arm, as judged by the strong model. Only game 1 was on the owner sheet.',
      '',
      '| Arm | Later-game questions | Repeats of an earlier game | Dropped by the same-answer filter |',
      '|---|---|---|---|',
      ...rows,
      '',
    ].join('\n');
  }
  await writePrivate(path.join(runDir, 'report.md'), markdown);
  console.log(
    `Rated ${ratings.ratings.size}/${Object.keys(key).length}; ${ratings.errors.length} sheet problems.`
  );
  for (const error of [...ratings.errors, ...(facts?.errors ?? [])]) console.log(`  - ${error}`);
  console.log(`Report: ${path.join(runDir, 'report.md')}`);
}

/** Only game 1 (and the anchors) go on the owner's blind sheet. */
function ratedCandidates(candidates: Candidate[]): Candidate[] {
  return candidates.filter((c) => (c.game ?? 1) === 1);
}

/**
 * Repeat check across simulated games: for each arm, theme and later game, a strong model lists
 * the questions that repeat a fact from an earlier game. Writes repeats.json.
 */
async function commandRepeats(
  config: EvalConfig,
  flags: Map<string, string | true>
): Promise<void> {
  const runDir = await resolveRunDir(flags);
  const model = flagString(flags, 'model') ?? config.judgeModel;
  const maxUsd = Number(flagString(flags, 'max-usd') ?? '1');
  requirePrice(model);
  const file = JSON.parse(
    await readFile(path.join(runDir, 'candidates.json'), 'utf8')
  ) as CandidatesFile;
  const games = file.gamesPerTheme ?? 1;
  if (games < 2)
    throw new Error('This run has one game per theme, so there is nothing to compare.');
  const jobs: Array<{ arm: string; themeId: string; theme: string; game: number }> = [];
  for (const spec of armsOf(file))
    for (const theme of file.themes)
      for (let game = 2; game <= games; game++)
        jobs.push({ arm: spec.id, themeId: theme.id, theme: theme.theme, game });
  console.log(
    `Repeat check: ${jobs.length} comparisons with ${model} | spend cap: $${maxUsd.toFixed(2)}`
  );
  if (flags.get('dry-run')) {
    console.log('Dry run: no requests made.');
    return;
  }
  requireKeyVariable();
  const tracker = new SpendTracker(maxUsd);
  installSpendTracking(tracker);
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, maxRetries: 1 });
  const results: Array<{
    arm: string;
    themeId: string;
    game: number;
    later: number;
    repeats: Array<{ later: string; earlier: string; why: string }>;
  }> = [];
  for (const job of jobs) {
    const mine = file.candidates.filter((c) => c.group === job.arm && c.themeId === job.themeId);
    const earlier = mine.filter((c) => (c.game ?? 1) < job.game);
    const later = mine.filter((c) => (c.game ?? 1) === job.game);
    if (later.length === 0 || earlier.length === 0) {
      results.push({ ...job, later: later.length, repeats: [] });
      continue;
    }
    const response = await openai.responses.create({
      model,
      reasoning: { effort: 'low' },
      input: buildRepeatCheckPrompt(job.theme, earlier, later),
      text: { format: { type: 'json_object' } },
      max_output_tokens: 2_000,
    });
    const repeats = parseRepeatCheck(
      response.output_text ?? '',
      earlier.map((c) => c.id),
      later.map((c) => c.id)
    );
    results.push({
      arm: job.arm,
      themeId: job.themeId,
      game: job.game,
      later: later.length,
      repeats,
    });
    console.log(
      `  ${job.arm} ${job.themeId} game ${job.game}: ${repeats.length}/${later.length} repeats`
    );
  }
  await writePrivate(
    path.join(runDir, 'repeats.json'),
    JSON.stringify(
      { model, createdAt: new Date().toISOString(), costUsd: tracker.totalUsd, results },
      null,
      2
    )
  );
  console.log(`Repeat check done | $${tracker.totalUsd.toFixed(4)}`);
}

/** Title of an English Wikipedia article URL, or null for any other URL. */
function wikipediaTitleFromUrl(url: string): string | null {
  const match = /^https?:\/\/en\.(?:m\.)?wikipedia\.org\/wiki\/([^#?]+)/.exec(url);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]).replace(/_/g, ' ');
  } catch {
    return null;
  }
}

async function fetchArticleText(
  title: string
): Promise<{ title: string; url: string; text: string } | null> {
  const page = (await wikipediaJson(buildWikipediaExtractUrl(title))) as {
    query?: {
      pages?: Array<{ title?: string; extract?: string; fullurl?: string; missing?: boolean }>;
    };
  };
  const first = page.query?.pages?.[0];
  if (!first || first.missing || !first.extract || !first.fullurl) return null;
  return {
    title: first.title ?? title,
    url: first.fullurl,
    text: cleanWikipediaExtract(first.extract, 400_000),
  };
}

/**
 * Evidence check for every item in the run: find Wikipedia articles for the claim, keep the
 * related passages, and ask a strong model for a quoted verdict. Writes verify.json.
 */
async function commandVerify(config: EvalConfig, flags: Map<string, string | true>): Promise<void> {
  const runDir = await resolveRunDir(flags);
  const model = flagString(flags, 'model') ?? config.verifyModel ?? config.judgeModel;
  const maxUsd = Number(flagString(flags, 'max-usd') ?? '2');
  requirePrice(model);
  requirePrice(TRIVIA_AI_REQUEST_CONFIG.model);
  const candidatesFile = JSON.parse(
    await readFile(path.join(runDir, 'candidates.json'), 'utf8')
  ) as CandidatesFile;
  const key = JSON.parse(await readFile(path.join(runDir, 'key.json'), 'utf8')) as Record<
    string,
    BlindKeyEntry
  >;
  const byId = new Map(candidatesFile.candidates.map((c) => [c.id, c]));
  const items = Object.keys(key).sort();
  console.log(
    `Evidence check for ${items.length} items: queries by ${TRIVIA_AI_REQUEST_CONFIG.model}, verdicts by ${model} | spend cap: $${maxUsd.toFixed(2)}`
  );
  if (flags.get('dry-run')) {
    console.log('Dry run: no requests made.');
    return;
  }
  requireKeyVariable();

  const tracker = new SpendTracker(maxUsd);
  installSpendTracking(tracker);
  const openai = new OpenAI({ apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY, maxRetries: 1 });
  const results: Record<
    string,
    EvidenceResult & { articles: Array<{ title: string; url: string }> }
  > = {};

  for (const item of items) {
    const candidate = byId.get(key[item].candidateId)!;
    const q = candidate.question;
    try {
      const queryResponse = await openai.chat.completions.create({
        ...TRIVIA_AI_REQUEST_CONFIG,
        messages: [{ role: 'user', content: buildEvidenceQueryPrompt(candidate.theme, q) }],
        response_format: { type: 'json_object' },
        max_completion_tokens: 300,
      });
      const queries = parseEvidenceQueries(queryResponse.choices[0]?.message?.content ?? '');
      const titles: string[] = [];
      const fromSource = wikipediaTitleFromUrl(q.sourceUrl);
      if (fromSource) titles.push(fromSource);
      for (const query of queries) {
        const search = (await wikipediaJson(buildWikipediaSearchUrl(query, 2))) as {
          query?: { search?: Array<{ title: string }> };
        };
        for (const r of search.query?.search ?? []) titles.push(r.title);
      }
      const articles: Array<{ title: string; url: string; passages: string }> = [];
      for (const title of Array.from(new Set(titles))) {
        if (articles.length >= EVIDENCE_ARTICLES) break;
        const article = await fetchArticleText(title);
        if (!article || articles.some((a) => a.url === article.url)) continue;
        const passages = selectPassages(article.text, q, EVIDENCE_PASSAGE_CHARS);
        if (passages) articles.push({ title: article.title, url: article.url, passages });
      }
      const verdictResponse = await openai.responses.create({
        model,
        reasoning: { effort: 'low' },
        input: buildEvidenceVerdictPrompt(candidate.theme, q, articles),
        text: { format: { type: 'json_object' } },
        max_output_tokens: 2_000,
      });
      const parsed = parseEvidenceVerdict(
        verdictResponse.output_text ?? '',
        articles.map((a) => a.passages).join('\n\n')
      );
      results[item] = { ...parsed, articles: articles.map(({ title, url }) => ({ title, url })) };
    } catch (error) {
      if (error instanceof SpendLimitError) throw error;
      results[item] = {
        verdict: 'not_found',
        quote: '',
        url: '',
        quoteVerified: false,
        otherAnswers: [],
        reason: `check failed: ${error instanceof Error ? error.message : String(error)}`,
        decision: 'hold',
        articles: [],
      };
    }
    console.log(`  ${item}: ${results[item].decision} | $${tracker.totalUsd.toFixed(4)}`);
  }

  await writePrivate(
    path.join(runDir, 'verify.json'),
    JSON.stringify(
      {
        model,
        queryModel: TRIVIA_AI_REQUEST_CONFIG.model,
        createdAt: new Date().toISOString(),
        costUsd: tracker.totalUsd,
        results,
      },
      null,
      2
    )
  );
  const counts = Object.values(results).reduce<Record<string, number>>((acc, r) => {
    acc[r.decision] = (acc[r.decision] ?? 0) + 1;
    return acc;
  }, {});
  console.log(
    `Evidence check done: ${counts.pass ?? 0} pass, ${counts.fail ?? 0} fail, ${counts.hold ?? 0} hold | $${tracker.totalUsd.toFixed(4)}`
  );
}

/**
 * Writes rating-page.html for the run: the committed template with this run's blind items
 * injected. It holds only the blind sheet's fields (never the group or any judge output) and
 * contains answers, so it stays in the gitignored run folder.
 */
async function commandRatingPage(flags: Map<string, string | true>): Promise<void> {
  const runDir = await resolveRunDir(flags);
  const candidatesFile = JSON.parse(
    await readFile(path.join(runDir, 'candidates.json'), 'utf8')
  ) as CandidatesFile;
  const key = JSON.parse(await readFile(path.join(runDir, 'key.json'), 'utf8')) as Record<
    string,
    BlindKeyEntry
  >;
  const byId = new Map(candidatesFile.candidates.map((c) => [c.id, c]));
  const items = Object.keys(key)
    .sort()
    .map((item) => {
      const c = byId.get(key[item].candidateId)!;
      return {
        item,
        theme: c.theme,
        question: c.question.question,
        answer: c.question.answer,
        alsoAccept: c.question.acceptableAnswers,
        explanation: c.question.explanation,
        difficulty: c.question.difficulty,
        source: c.question.sourceUrl,
      };
    });
  const title = (flagString(flags, 'title') ?? 'Question Rating Session').replace(/[<>&"]/g, '');
  const template = await readFile(RATING_PAGE_TEMPLATE, 'utf8');
  if (template.split('__ITEMS__').length !== 2)
    throw new Error('Template must contain __ITEMS__ once');
  const html = template
    .replace(/__TITLE__/g, title)
    .replace('__ITEMS__', JSON.stringify(items).replace(/<\//g, '<\\/'));
  const out = path.join(runDir, 'rating-page.html');
  await writePrivate(out, html);
  console.log(`Rating page with ${items.length} items: ${out}`);
}

/**
 * Converts a rating page export (one JSON file per item, as saved by ArtifactData with out_dir)
 * into the run's ratings.csv.
 */
async function commandImportRatings(flags: Map<string, string | true>): Promise<void> {
  const runDir = await resolveRunDir(flags);
  const from = flagString(flags, 'from');
  if (!from) throw new Error('Pass --from <folder of exported rating JSON files>');
  const target = path.join(runDir, 'ratings.csv');
  if (existsSync(target) && !flags.get('overwrite')) {
    throw new Error(`${target} already exists. Pass --overwrite to replace it.`);
  }
  const files = (await readdir(from)).filter((f) => f.endsWith('.json')).sort();
  const rows: string[][] = [['item', ...RATING_COLUMNS]];
  for (const file of files) {
    const doc = JSON.parse(await readFile(path.join(from, file), 'utf8')) as {
      id?: string;
      data?: Record<string, unknown>;
    };
    const body = (doc.data ?? doc) as Record<string, unknown>;
    const item = doc.id ?? file.replace(/\.json$/, '');
    rows.push([item, ...RATING_COLUMNS.map((c) => String(body[c] ?? ''))]);
  }
  await writePrivate(target, toCsv(rows));
  console.log(`Imported ${rows.length - 1} ratings to ${target}`);
}

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv.slice(2));
  const configPath = flagString(flags, 'config') ?? DEFAULT_CONFIG_PATH;
  const config = JSON.parse(await readFile(configPath, 'utf8')) as EvalConfig;
  if (command === 'generate') await commandGenerate(config, flags);
  else if (command === 'judge') await commandJudge(config, flags);
  else if (command === 'verify') await commandVerify(config, flags);
  else if (command === 'repeats') await commandRepeats(config, flags);
  else if (command === 'rating-page') await commandRatingPage(flags);
  else if (command === 'import-ratings') await commandImportRatings(flags);
  else if (command === 'score') await commandScore(flags);
  else {
    console.log(
      'Usage: npm run eval:questions -- <generate|judge|verify|repeats|rating-page|import-ratings|score> [--config <file>] [--run <dir>] [--dry-run] [--max-usd <n>]'
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('question-eval failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
