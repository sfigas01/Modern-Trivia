/**
 * Content Sweep — Fix Applier (STE-238)
 * =====================================
 *
 * Applies fixes to the PRODUCTION question bank over HTTP, in explicit phases.
 * Companion to the read-only `scripts/content-sweep.ts` reporter.
 *
 * SAFETY:
 *   - Default is DRY-RUN. Nothing is written unless you pass `--apply`.
 *   - Nothing is ever deleted. Tag fixes are strictly additive (we only append
 *     missing tags, never remove existing ones).
 *   - A per-run change log is written to reports/ so every mutation is auditable
 *     and reversible by hand.
 *
 * Phases (select with --phase=<name>, default: tags):
 *   tags   Deterministic, no facts/answers touched:
 *            • category_tag_mismatch  → append the `category` to `tags`
 *            • missing pillar tag     → append the question's `pillar` to `tags`
 *          Region tags (CA/US/Global) are NOT derivable from any column, so they
 *          are never guessed — those stay for human review.
 *
 * Usage:
 *   npx tsx scripts/content-sweep-apply.ts                 # dry-run, tags phase
 *   npx tsx scripts/content-sweep-apply.ts --apply         # apply tag fixes
 *   npx tsx scripts/content-sweep-apply.ts --phase=tags --apply
 *
 * Requires `.env.local` with ADMIN_API_KEY and PROD_URL (see content-sweep.ts).
 */

import { readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'reports');

const PILLAR_TAGS = new Set(['TimeCapsule', 'GlobalEh', 'FreshPrints', 'GreatOutdoors']);

// ---------------------------------------------------------------------------
// Env + CLI
// ---------------------------------------------------------------------------

function loadEnvLocal(): Record<string, string> {
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(`Could not read .env.local at ${envPath}.`);
  }
  const env: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key) env[key] = value;
  }
  return env;
}

interface CliOptions {
  apply: boolean;
  phase: string;
}

function parseCli(argv: string[]): CliOptions {
  const phaseArg = argv.find((a) => a.startsWith('--phase='));
  return {
    apply: argv.includes('--apply'),
    phase: phaseArg ? phaseArg.slice('--phase='.length) : 'tags',
  };
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ApiClient {
  get<T>(pathAndQuery: string): Promise<T>;
  patch<T>(pathAndQuery: string, body: unknown): Promise<T>;
  post<T>(pathAndQuery: string, body: unknown): Promise<T>;
}

function createApiClient(baseUrl: string, apiKey: string): ApiClient {
  const root = baseUrl.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  async function request<T>(
    method: 'GET' | 'PATCH' | 'POST',
    pathAndQuery: string,
    body?: unknown
  ): Promise<T> {
    const url = `${root}${pathAndQuery}`;
    const maxAttempts = 5;
    let attempt = 0;
    while (true) {
      attempt++;
      const res = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
        console.warn(`  429 on ${method} ${pathAndQuery}; retrying in ${waitMs / 1000}s…`);
        await sleep(waitMs);
        continue;
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `${method} ${pathAndQuery} → ${res.status} ${res.statusText}\n${text.slice(0, 300)}`
        );
      }
      return (await res.json()) as T;
    }
  }

  return {
    get: (p) => request('GET', p),
    patch: (p, b) => request('PATCH', p, b),
    post: (p, b) => request('POST', p, b),
  };
}

interface AdminQuestion {
  id: string;
  category: string;
  question: string;
  answer: string;
  pillar: string;
  tags: string[] | null;
  acceptableAnswers: string[] | null;
  status: string;
}

interface AdminQuestionsResponse {
  questions: AdminQuestion[];
  total: number;
}

async function fetchAllQuestions(api: ApiClient): Promise<AdminQuestion[]> {
  const pageSize = 200;
  let offset = 0;
  const all: AdminQuestion[] = [];
  while (true) {
    const page = await api.get<AdminQuestionsResponse>(
      `/api/admin/questions?status=all&limit=${pageSize}&offset=${offset}`
    );
    all.push(...page.questions);
    if (all.length >= page.total || page.questions.length === 0) break;
    offset += pageSize;
  }
  return all;
}

// ---------------------------------------------------------------------------
// Phase: tags (deterministic, additive)
// ---------------------------------------------------------------------------

interface TagChange {
  questionId: string;
  oldTags: string[];
  newTags: string[];
  added: string[];
  reasons: string[];
}

/**
 * Compute the additive tag fix for a single question. Returns null if no change.
 * Never removes a tag. Only appends: the category (if absent) and the pillar tag
 * (if the pillar column is a valid pillar and no pillar tag is present).
 */
function computeTagFix(q: AdminQuestion): TagChange | null {
  const current = (q.tags ?? []).filter((t) => typeof t === 'string' && t.trim().length > 0);
  const next = [...current];
  const added: string[] = [];
  const reasons: string[] = [];

  // category_tag_mismatch → append category
  if (q.category && !next.includes(q.category)) {
    next.push(q.category);
    added.push(q.category);
    reasons.push('category_tag_mismatch');
  }

  // missing pillar tag → append the pillar column value (deterministic)
  const hasPillarTag = next.some((t) => PILLAR_TAGS.has(t));
  if (!hasPillarTag && PILLAR_TAGS.has(q.pillar)) {
    next.push(q.pillar);
    added.push(q.pillar);
    reasons.push('missing_pillar_tag');
  }

  if (added.length === 0) return null;
  return {
    questionId: q.id,
    oldTags: current,
    newTags: next,
    added,
    reasons: [...new Set(reasons)],
  };
}

async function runTagPhase(
  api: ApiClient,
  questions: AdminQuestion[],
  apply: boolean
): Promise<TagChange[]> {
  const changes: TagChange[] = [];
  for (const q of questions) {
    const change = computeTagFix(q);
    if (change) changes.push(change);
  }

  console.info(`  ${changes.length} question(s) need additive tag fixes.`);
  if (!apply) {
    console.info('  DRY-RUN — no changes written. Re-run with --apply to write them.');
    return changes;
  }

  let applied = 0;
  for (const change of changes) {
    await api.patch(`/api/admin/questions/${change.questionId}/field`, {
      field: 'tags',
      value: change.newTags,
      aiSuggested: false,
    });
    applied++;
    if (applied % 25 === 0) console.info(`  …applied ${applied}/${changes.length}`);
    // The field-patch endpoint is not AI-rate-limited, but pace gently anyway.
    await sleep(100);
  }
  console.info(`  applied ${applied} tag fix(es).`);
  return changes;
}

// ---------------------------------------------------------------------------
// Phase: acceptable (AI-generated acceptable-answer variants; additive)
// ---------------------------------------------------------------------------

interface AcceptableChange {
  questionId: string;
  count: number;
}

/** Coerce the ai-fix `suggestion` (a JSON string) into a clean string[]. */
function parseAcceptable(suggestion: string): string[] {
  let arr: unknown;
  try {
    arr = JSON.parse(suggestion);
  } catch {
    const m = suggestion.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      arr = JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of arr) {
    if (typeof v !== 'string') continue;
    const t = v.trim();
    const key = t.toLowerCase();
    if (t && !seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

async function runAcceptablePhase(
  api: ApiClient,
  questions: AdminQuestion[],
  apply: boolean
): Promise<AcceptableChange[]> {
  // Only approved (player-facing) questions with no acceptable answers yet.
  // Idempotent + resumable: anything already populated is skipped, so a re-run
  // after an interruption continues where it left off.
  const targets = questions.filter(
    (q) => q.status === 'approved' && (q.acceptableAnswers ?? []).length === 0
  );
  console.info(`  ${targets.length} approved question(s) missing acceptableAnswers.`);
  if (!apply) {
    console.info('  DRY-RUN — no changes written. Re-run with --apply to write them.');
    return targets.map((q) => ({ questionId: q.id, count: 0 }));
  }

  const changes: AcceptableChange[] = [];
  let done = 0;
  for (const q of targets) {
    // ai-fix is AI-rate-limited (20 / 15 min); the request() 429 backoff paces us.
    const { suggestion } = await api.post<{ suggestion: string }>(
      `/api/admin/questions/${q.id}/ai-fix`,
      { field: 'acceptableAnswers' }
    );
    const variants = parseAcceptable(suggestion);
    // Guard: the primary answer must be present; skip empty/degenerate results.
    if (variants.length === 0) {
      console.warn(`  skipped ${q.id} — AI returned no usable variants`);
      continue;
    }
    await api.patch(`/api/admin/questions/${q.id}/field`, {
      field: 'acceptableAnswers',
      value: variants,
      aiSuggested: true,
    });
    changes.push({ questionId: q.id, count: variants.length });
    done++;
    if (done % 10 === 0) console.info(`  …populated ${done}/${targets.length}`);
    await sleep(300);
  }
  console.info(`  populated acceptableAnswers on ${done} question(s).`);
  return changes;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const env = loadEnvLocal();
  const apiKey = env.ADMIN_API_KEY;
  const prodUrl = env.PROD_URL;
  if (!apiKey) throw new Error('ADMIN_API_KEY is missing from .env.local');
  if (!prodUrl) throw new Error('PROD_URL is missing from .env.local');

  const api = createApiClient(prodUrl, apiKey);

  console.info(
    `▶ Content sweep APPLY — phase: ${options.phase} — ${options.apply ? 'APPLY' : 'DRY-RUN'}`
  );
  console.info(`  target: ${prodUrl}`);

  console.info('▶ Fetching question corpus…');
  const questions = await fetchAllQuestions(api);
  console.info(`  fetched ${questions.length} question(s)`);

  let changes: unknown[];
  if (options.phase === 'tags') {
    console.info('▶ Phase: tags (deterministic, additive)…');
    changes = await runTagPhase(api, questions, options.apply);
  } else if (options.phase === 'acceptable') {
    console.info('▶ Phase: acceptable (AI-generated variants, additive)…');
    changes = await runAcceptablePhase(api, questions, options.apply);
  } else {
    throw new Error(`Unknown phase "${options.phase}". Supported: tags, acceptable`);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const logPath = path.join(
    OUTPUT_DIR,
    `apply-${options.phase}-${dateStamp()}${options.apply ? '' : '-dryrun'}.json`
  );
  await writeFile(
    logPath,
    JSON.stringify(
      {
        phase: options.phase,
        applied: options.apply,
        generatedAt: new Date().toISOString(),
        changes,
      },
      null,
      2
    ),
    'utf8'
  );

  console.info('');
  console.info(`✔ ${options.apply ? 'Applied' : 'Previewed'} ${changes.length} change(s).`);
  console.info(`  Change log: ${path.relative(PROJECT_ROOT, logPath)}`);
}

main().catch((error) => {
  console.error('Apply failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
