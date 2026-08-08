/**
 * Content Quality Sweep Orchestrator — STE-238
 * ============================================
 *
 * Runs the full content quality sweep against the PRODUCTION Modern Trivia app
 * over HTTP, using the admin API key bypass (see docs/guides/content-sweep-plan.md).
 *
 * What it does:
 *   1. Loads ADMIN_API_KEY + PROD_URL from `.env.local` in the project root.
 *   2. Calls the admin quality-sweep endpoint, which runs the existing pipeline:
 *      static heuristic audit + duplicate detection + AI fact-checking.
 *   3. Fetches the full approved corpus and runs TWO extra static checks the
 *      server pipeline doesn't cover yet:
 *        - false_nationality_framing  ("not a <nationality>" false-premise answers)
 *        - missing_acceptable_answers (no acceptableAnswers → false rejections)
 *   4. Triages every finding into auto-fix / needs-review / dismiss buckets.
 *   5. Writes a JSON report and a human-readable Markdown report to `reports/`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ANSWER SECRECY (critical):
 *   The person running this sweep is also a player. The reports must NEVER reveal
 *   a question's answer — a false-positive finding must not spoil the game.
 *   Every free-text field written to either report is passed through a per-question
 *   redactor that strips the answer, its acceptable variants, and its keywords.
 *   Raw answer fields from the API (questionsById[].answer, duplicate answerA/B,
 *   etc.) are dropped entirely and never serialized.
 *
 * This script is READ-ONLY by default: it reports, it does not mutate prod. The
 * "auto-fix" bucket lists findings that are *safe to auto-fix*; applying them is a
 * separate, deliberate step (see the plan's Auto-Fix phase).
 *
 * Usage:
 *   npx tsx scripts/content-sweep.ts [--skip-fact-check] [--skip-duplicates]
 *
 * Requires `.env.local` with:
 *   ADMIN_API_KEY=<the admin API key set in Replit Secrets>
 *   PROD_URL=https://<your-prod-host>
 */

import { readFileSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

import type { QualitySweepReport } from '../shared/models/quality-sweep';
import type {
  QuestionQualityFinding,
  QuestionQualitySeverity,
} from '../server/lib/question-quality-audit';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const OUTPUT_DIR = path.join(PROJECT_ROOT, 'reports');

// ---------------------------------------------------------------------------
// Env loading (.env.local)
// ---------------------------------------------------------------------------

/**
 * Minimal .env parser — we don't want to add a dotenv dependency for one script.
 * Supports KEY=VALUE lines, `#` comments, blank lines, and surrounding quotes.
 */
function loadEnvLocal(): Record<string, string> {
  const envPath = path.join(PROJECT_ROOT, '.env.local');
  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf8');
  } catch {
    throw new Error(
      `Could not read .env.local at ${envPath}.\n` +
        `Create it with:\n  ADMIN_API_KEY=<key>\n  PROD_URL=https://<host>`
    );
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

// ---------------------------------------------------------------------------
// CLI options
// ---------------------------------------------------------------------------

interface CliOptions {
  skipFactCheck: boolean;
  skipDuplicates: boolean;
}

function parseCliOptions(argv: string[]): CliOptions {
  return {
    skipFactCheck: argv.includes('--skip-fact-check'),
    skipDuplicates: argv.includes('--skip-duplicates'),
  };
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

interface ApiClient {
  get<T>(pathAndQuery: string): Promise<T>;
  post<T>(pathAndQuery: string, body: unknown): Promise<T>;
}

function createApiClient(baseUrl: string, apiKey: string): ApiClient {
  const root = baseUrl.replace(/\/$/, '');
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  async function request<T>(
    method: 'GET' | 'POST',
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

      // Respect rate limiting (aiLimiter) with exponential backoff.
      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfter = Number(res.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
        console.warn(
          `  429 rate limited on ${method} ${pathAndQuery}; retrying in ${waitMs / 1000}s…`
        );
        await sleep(waitMs);
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(
          `${method} ${pathAndQuery} → ${res.status} ${res.statusText}\n${text.slice(0, 500)}`
        );
      }

      return (await res.json()) as T;
    }
  }

  return {
    get: (pathAndQuery) => request('GET', pathAndQuery),
    post: (pathAndQuery, body) => request('POST', pathAndQuery, body),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Admin questions endpoint shapes (only the fields we consume)
// ---------------------------------------------------------------------------

interface AdminQuestion {
  id: string;
  category: string;
  difficulty: string;
  question: string;
  answer: string;
  acceptableAnswers: string[] | null;
  explanation: string;
  pillar: string;
  tags: string[] | null;
  sourceUrl: string | null;
  sourceName: string | null;
  status: string;
  createdAt: string;
}

interface AdminQuestionsResponse {
  questions: AdminQuestion[];
  total: number;
  categories: string[];
  pillars: string[];
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
// Answer redaction — the core secrecy guarantee
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
  'was',
  'are',
  'were',
  'not',
  'a',
  'an',
  'of',
  'in',
  'on',
  'to',
  'is',
  'it',
  'as',
  'by',
  'or',
]);

/**
 * Build the set of secret strings for a question: the answer, every acceptable
 * variant, and each meaningful keyword within them. Anything in this set gets
 * scrubbed out of report text so a false positive can never leak the answer.
 */
function buildSecrets(answer: string, acceptableAnswers: string[] | null): string[] {
  const raw = [answer, ...(acceptableAnswers ?? [])].map((s) => (s ?? '').trim()).filter(Boolean);

  const secrets = new Set<string>();
  for (const value of raw) {
    secrets.add(value);
    // Individual words of length >= 4 catch keyword/stem leakage in messages.
    for (const word of value.split(/\s+/)) {
      const clean = word.replace(/[^\p{L}\p{N}]/gu, '');
      if (clean.length >= 4 && !STOPWORDS.has(clean.toLowerCase())) {
        secrets.add(clean);
      }
    }
  }

  // Redact longest first so multi-word answers are removed before their words.
  return [...secrets].sort((a, b) => b.length - a.length);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Remove every secret occurrence (case-insensitive) from a piece of text.
 * Used for ALL free-text emitted for a flagged question, from every check.
 */
function redact(text: string | undefined | null, secrets: string[]): string {
  if (!text) return '';
  let out = text;
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.replace(new RegExp(escapeRegExp(secret), 'gi'), '[REDACTED]');
  }
  return out;
}

// ---------------------------------------------------------------------------
// New static checks (not covered by the server pipeline)
// ---------------------------------------------------------------------------

type NewCheckRule = 'false_nationality_framing' | 'missing_acceptable_answers';

interface NewFinding {
  questionId: string;
  rule: NewCheckRule;
  severity: QuestionQualitySeverity;
  /** Safe, answer-free description of the problem. */
  message: string;
}

// A pragmatic demonym list plus a suffix heuristic. Not exhaustive — the goal is
// to flag the obvious "not a <nationality>" false-premise answers for review.
const DEMONYMS = new Set(
  [
    'canadian',
    'american',
    'british',
    'english',
    'irish',
    'scottish',
    'welsh',
    'french',
    'german',
    'spanish',
    'italian',
    'portuguese',
    'dutch',
    'belgian',
    'swiss',
    'austrian',
    'greek',
    'russian',
    'polish',
    'swedish',
    'norwegian',
    'danish',
    'finnish',
    'icelandic',
    'mexican',
    'brazilian',
    'argentine',
    'argentinian',
    'chilean',
    'peruvian',
    'colombian',
    'cuban',
    'jamaican',
    'chinese',
    'japanese',
    'korean',
    'vietnamese',
    'thai',
    'indian',
    'pakistani',
    'bangladeshi',
    'indonesian',
    'filipino',
    'malaysian',
    'singaporean',
    'australian',
    'zealander',
    'egyptian',
    'nigerian',
    'kenyan',
    'ethiopian',
    'moroccan',
    'algerian',
    'ghanaian',
    'south african',
    'israeli',
    'turkish',
    'iranian',
    'iraqi',
    'saudi',
    'lebanese',
    'syrian',
    'ukrainian',
    'czech',
    'hungarian',
    'romanian',
    'bulgarian',
    'croatian',
    'serbian',
    'european',
    'asian',
    'african',
    'scandinavian',
    'nordic',
    'latino',
    'hispanic',
  ].map((d) => d.toLowerCase())
);

// Matches "not a Canadian", "not Canadian", "is not an American", etc.
const NOT_A_PATTERN = /\bnot\s+(?:an?\s+)?([A-Za-z][A-Za-z-]+(?:\s+[A-Z][a-z]+)?)/g;

function looksLikeDemonym(word: string): boolean {
  const w = word.trim().toLowerCase();
  if (DEMONYMS.has(w)) return true;
  // Suffix heuristic for demonyms not in the list, on a capitalized token.
  return /^[A-Z][a-z]+(ian|ish|ese|i|er)$/.test(word.trim()) && word.trim().length > 4;
}

function checkFalseNationalityFraming(q: AdminQuestion): NewFinding | null {
  const answer = q.answer ?? '';
  NOT_A_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NOT_A_PATTERN.exec(answer)) !== null) {
    const descriptor = match[1];
    if (looksLikeDemonym(descriptor)) {
      return {
        questionId: q.id,
        rule: 'false_nationality_framing',
        severity: 'high',
        message:
          'Answer contains a "not a [nationality/descriptor]" construction, which asserts a ' +
          'false premise. These questions are typically broken and need a rewrite. (Answer hidden.)',
      };
    }
  }
  return null;
}

const PROPER_NOUN_RE = /\b[A-Z][a-z]+/;
const DATE_RE = /\b(1[0-9]{3}|20[0-9]{2})\b|\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/;
const NUMBER_RE =
  /^\s*[$£€]?\s*\d[\d,.]*\s*(%|percent|million|billion|thousand|km|kg|m|ft|°?[cf])?\s*$/i;

function classifyAnswerShape(answer: string): 'proper noun' | 'date' | 'number' | 'other' {
  const a = answer.trim();
  if (NUMBER_RE.test(a)) return 'number';
  if (DATE_RE.test(a)) return 'date';
  if (PROPER_NOUN_RE.test(a)) return 'proper noun';
  return 'other';
}

function checkMissingAcceptableAnswers(q: AdminQuestion): NewFinding | null {
  const list = q.acceptableAnswers ?? [];
  if (list.length > 0) return null;

  const shape = classifyAnswerShape(q.answer ?? '');
  // A proper noun / date / number with no accepted variants is the highest-risk
  // case for false rejections (typos, abbreviations, formatting differences).
  const highRisk = shape !== 'other';
  return {
    questionId: q.id,
    rule: 'missing_acceptable_answers',
    severity: highRisk ? 'medium' : 'low',
    message:
      `Question has no acceptableAnswers. The answer is a ${shape}, ` +
      `which is prone to false rejections without accepted variants. (Answer hidden.)`,
  };
}

function runNewChecks(questions: AdminQuestion[]): NewFinding[] {
  const findings: NewFinding[] = [];
  for (const q of questions) {
    const nat = checkFalseNationalityFraming(q);
    if (nat) findings.push(nat);
    const acc = checkMissingAcceptableAnswers(q);
    if (acc) findings.push(acc);
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

type TriageBucket = 'auto-fix' | 'needs-review' | 'dismiss';

/**
 * Map a server-audit finding to a triage bucket, per the plan.
 */
function triageStaticFinding(f: QuestionQualityFinding): TriageBucket {
  switch (f.rule) {
    case 'missing_source_metadata':
    case 'category_tag_mismatch':
    case 'missing_required_tags':
      return 'auto-fix';
    case 'answer_leakage':
      // Low-severity morphological stem matches are overwhelmingly false positives.
      return f.severity === 'low' ? 'dismiss' : 'needs-review';
    case 'duplicate_question_id':
    case 'missing_required_field':
    case 'invalid_difficulty':
      return 'needs-review';
    default:
      return 'needs-review';
  }
}

// Both new checks describe broken/risky content the human should decide on.
const NEW_FINDING_BUCKET: TriageBucket = 'needs-review';

// ---------------------------------------------------------------------------
// Report assembly
// ---------------------------------------------------------------------------

interface TriagedFinding {
  questionId: string;
  source: 'static' | 'fact_check' | 'duplicate' | 'new';
  rule: string;
  severity: string;
  /** Redacted, answer-free description. */
  description: string;
}

interface QuestionReportEntry {
  questionId: string;
  /** Question text is safe to show; the answer is never included. */
  questionText: string;
  category: string;
  pillar: string;
  difficulty: string;
  hasSource: boolean;
  findings: TriagedFinding[];
}

interface SweepReport {
  metadata: {
    generatedAt: string;
    prodUrl: string;
    totalQuestions: number;
    sweepDurationSeconds: number;
    factCheckRun: boolean;
    duplicatesRun: boolean;
    readOnly: true;
  };
  summary: {
    static: Record<QuestionQualitySeverity, number>;
    duplicates: { exact: number; near_duplicate: number; conceptual: number } | null;
    factCheck: { pass: number; flag: number; fail: number } | null;
    newChecks: { false_nationality_framing: number; missing_acceptable_answers: number };
    byBucket: Record<TriageBucket, number>;
  };
  buckets: Record<TriageBucket, QuestionReportEntry[]>;
  recommendations: string[];
}

interface BuildReportArgs {
  prodUrl: string;
  durationSeconds: number;
  sweep: QualitySweepReport;
  questions: AdminQuestion[];
  newFindings: NewFinding[];
  options: CliOptions;
}

function buildReport(args: BuildReportArgs): SweepReport {
  const { prodUrl, durationSeconds, sweep, questions, newFindings, options } = args;

  // Per-question secret sets, built from the fetched corpus (has answers).
  const byId = new Map<string, AdminQuestion>();
  const secretsById = new Map<string, string[]>();
  for (const q of questions) {
    byId.set(q.id, q);
    secretsById.set(q.id, buildSecrets(q.answer, q.acceptableAnswers));
  }
  const secretsFor = (id: string) => secretsById.get(id) ?? [];

  // Accumulate triaged findings keyed by question, keeping only redacted text.
  const entriesByBucket: Record<TriageBucket, Map<string, QuestionReportEntry>> = {
    'auto-fix': new Map(),
    'needs-review': new Map(),
    dismiss: new Map(),
  };

  const ensureEntry = (bucket: TriageBucket, questionId: string): QuestionReportEntry => {
    const map = entriesByBucket[bucket];
    let entry = map.get(questionId);
    if (!entry) {
      const q = byId.get(questionId);
      const snap = sweep.questionsById?.[questionId];
      entry = {
        questionId,
        questionText: q?.question ?? snap?.question ?? '(question text unavailable)',
        category: q?.category ?? snap?.category ?? 'unknown',
        pillar: q?.pillar ?? snap?.pillar ?? 'unknown',
        difficulty: q?.difficulty ?? snap?.difficulty ?? 'unknown',
        hasSource: q ? Boolean(q.sourceUrl && q.sourceName) : Boolean(snap?.hasSource),
        findings: [],
      };
      map.set(questionId, entry);
    }
    return entry;
  };

  // 1. Server static audit findings.
  for (const f of sweep.audit.findings) {
    const bucket = triageStaticFinding(f);
    const entry = ensureEntry(bucket, f.questionId);
    // answer_leakage messages quote answer keywords — redact aggressively, and
    // for that rule replace the message entirely with a safe generic.
    const description =
      f.rule === 'answer_leakage'
        ? 'Answer text (or a keyword from it) appears in the question — possible answer leakage. (Details hidden.)'
        : redact(f.message, secretsFor(f.questionId));
    entry.findings.push({
      questionId: f.questionId,
      source: 'static',
      rule: f.rule,
      severity: f.severity,
      description,
    });
  }

  // 2. Fact-check verdicts (flag/fail need review; pass is not a finding).
  if (sweep.factCheck) {
    for (const r of sweep.factCheck.results) {
      if (r.verdict === 'pass') continue;
      const entry = ensureEntry('needs-review', r.questionId);
      entry.findings.push({
        questionId: r.questionId,
        source: 'fact_check',
        rule: `fact_check_${r.verdict}`,
        severity: r.verdict === 'fail' ? 'high' : 'medium',
        // The checker's reasoning can name the answer — redact it.
        description: `Fact-check ${r.verdict} (confidence ${r.confidence}): ${redact(
          r.reason,
          secretsFor(r.questionId)
        )}`,
      });
    }
  }

  // 3. Duplicate pairs — record on both questions, never emit the answers.
  if (sweep.duplicates) {
    for (const m of sweep.duplicates.duplicatesFound) {
      const secretsA = secretsFor(m.questionIdA);
      const secretsB = secretsFor(m.questionIdB);
      const bothSecrets = [...secretsA, ...secretsB];
      for (const [id, otherId] of [
        [m.questionIdA, m.questionIdB],
        [m.questionIdB, m.questionIdA],
      ] as const) {
        const entry = ensureEntry('needs-review', id);
        entry.findings.push({
          questionId: id,
          source: 'duplicate',
          rule: `duplicate_${m.matchType}`,
          severity: m.matchType === 'exact' ? 'high' : 'medium',
          description:
            `Possible ${m.matchType.replace('_', ' ')} duplicate (similarity ${m.similarityScore.toFixed(
              2
            )}) of question ${otherId}.` +
            (m.aiReasoning ? ` Reasoning: ${redact(m.aiReasoning, bothSecrets)}` : ''),
        });
      }
    }
  }

  // 4. New static checks.
  for (const f of newFindings) {
    const entry = ensureEntry(NEW_FINDING_BUCKET, f.questionId);
    entry.findings.push({
      questionId: f.questionId,
      source: 'new',
      rule: f.rule,
      severity: f.severity,
      description: redact(f.message, secretsFor(f.questionId)),
    });
  }

  const buckets: Record<TriageBucket, QuestionReportEntry[]> = {
    'auto-fix': [...entriesByBucket['auto-fix'].values()],
    'needs-review': [...entriesByBucket['needs-review'].values()],
    dismiss: [...entriesByBucket.dismiss.values()],
  };

  const newCounts = {
    false_nationality_framing: newFindings.filter((f) => f.rule === 'false_nationality_framing')
      .length,
    missing_acceptable_answers: newFindings.filter((f) => f.rule === 'missing_acceptable_answers')
      .length,
  };

  const recommendations = [...sweep.recommendations];
  if (newCounts.false_nationality_framing > 0) {
    recommendations.push(
      `${newCounts.false_nationality_framing} question(s) use "not a [nationality]" false-premise framing — rewrite.`
    );
  }
  if (newCounts.missing_acceptable_answers > 0) {
    recommendations.push(
      `${newCounts.missing_acceptable_answers} question(s) lack acceptableAnswers — add accepted variants to avoid false rejections.`
    );
  }

  return {
    metadata: {
      generatedAt: sweep.generatedAt,
      prodUrl,
      totalQuestions: sweep.totalQuestions,
      sweepDurationSeconds: Math.round(durationSeconds),
      factCheckRun: !options.skipFactCheck,
      duplicatesRun: !options.skipDuplicates,
      readOnly: true,
    },
    summary: {
      static: sweep.audit.findingsBySeverity,
      duplicates: sweep.duplicates ? sweep.duplicates.duplicatesByType : null,
      factCheck: sweep.factCheck
        ? {
            pass: sweep.factCheck.results.filter((r) => r.verdict === 'pass').length,
            flag: sweep.factCheck.results.filter((r) => r.verdict === 'flag').length,
            fail: sweep.factCheck.results.filter((r) => r.verdict === 'fail').length,
          }
        : null,
      newChecks: newCounts,
      byBucket: {
        'auto-fix': buckets['auto-fix'].length,
        'needs-review': buckets['needs-review'].length,
        dismiss: buckets.dismiss.length,
      },
    },
    buckets,
    recommendations,
  };
}

// ---------------------------------------------------------------------------
// Markdown rendering
// ---------------------------------------------------------------------------

function renderBucketSection(title: string, note: string, entries: QuestionReportEntry[]): string {
  const lines: string[] = [`## ${title} (${entries.length})`, '', `_${note}_`, ''];
  if (entries.length === 0) {
    lines.push('None.', '');
    return lines.join('\n');
  }
  for (const entry of entries) {
    lines.push(`### ${entry.questionText}`);
    lines.push('');
    lines.push(
      `- **Question ID:** \`${entry.questionId}\`  ` +
        `\n- **Category / Pillar / Difficulty:** ${entry.category} · ${entry.pillar} · ${entry.difficulty}  ` +
        `\n- **Has source:** ${entry.hasSource ? 'yes' : 'no'}`
    );
    lines.push('');
    lines.push('| Severity | Check | Problem (answer hidden) |');
    lines.push('| --- | --- | --- |');
    for (const f of entry.findings) {
      const desc = f.description.replace(/\n/g, ' ').replace(/\|/g, '\\|');
      lines.push(`| ${f.severity} | \`${f.rule}\` | ${desc} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function renderMarkdown(report: SweepReport): string {
  const m = report.metadata;
  const s = report.summary;
  const lines: string[] = [];

  lines.push('# Content Quality Sweep — Summary');
  lines.push('');
  lines.push(
    '> ⚠️ **Answers are redacted throughout this report.** Findings may be false positives; ' +
      'the actual answer is never shown so the sweep never spoils a question.'
  );
  lines.push('');
  lines.push(`- **Generated:** ${m.generatedAt}`);
  lines.push(`- **Target:** ${m.prodUrl}`);
  lines.push(`- **Total questions swept:** ${m.totalQuestions}`);
  lines.push(`- **Duration:** ${m.sweepDurationSeconds}s`);
  lines.push(
    `- **Fact-check:** ${m.factCheckRun ? 'run' : 'skipped'} · **Duplicates:** ${m.duplicatesRun ? 'run' : 'skipped'}`
  );
  lines.push(`- **Mode:** read-only (no changes were written to production)`);
  lines.push('');

  lines.push('## Summary counts');
  lines.push('');
  lines.push(
    `- **Static audit:** ${s.static.high} high · ${s.static.medium} medium · ${s.static.low} low`
  );
  if (s.factCheck) {
    lines.push(
      `- **Fact-check:** ${s.factCheck.pass} pass · ${s.factCheck.flag} flag · ${s.factCheck.fail} fail`
    );
  } else {
    lines.push('- **Fact-check:** skipped');
  }
  if (s.duplicates) {
    lines.push(
      `- **Duplicates:** ${s.duplicates.exact} exact · ${s.duplicates.near_duplicate} near · ${s.duplicates.conceptual} conceptual`
    );
  } else {
    lines.push('- **Duplicates:** skipped');
  }
  lines.push(
    `- **New checks:** ${s.newChecks.false_nationality_framing} false-nationality framing · ` +
      `${s.newChecks.missing_acceptable_answers} missing acceptableAnswers`
  );
  lines.push(
    `- **Triage:** ${s.byBucket['auto-fix']} auto-fix · ${s.byBucket['needs-review']} needs-review · ${s.byBucket.dismiss} dismiss`
  );
  lines.push('');

  lines.push('## Recommendations');
  lines.push('');
  for (const rec of report.recommendations) lines.push(`- ${rec}`);
  lines.push('');

  lines.push(
    renderBucketSection(
      'Needs review',
      'Answer hidden — you decide. Fact-check failures, duplicates, subjective prompts, high-severity leakage, and the new content checks.',
      report.buckets['needs-review']
    )
  );
  lines.push(
    renderBucketSection(
      'Auto-fix candidates',
      'Deterministic, low-risk fixes (source metadata, tags). Safe to auto-apply in a follow-up step — this run made no changes.',
      report.buckets['auto-fix']
    )
  );
  lines.push(
    renderBucketSection(
      'Dismiss',
      'Overwhelmingly false positives (e.g. low-severity morphological answer-leakage). Logged and skipped.',
      report.buckets.dismiss
    )
  );

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const env = loadEnvLocal();

  const apiKey = env.ADMIN_API_KEY;
  const prodUrl = env.PROD_URL;
  if (!apiKey) throw new Error('ADMIN_API_KEY is missing from .env.local');
  if (!prodUrl) throw new Error('PROD_URL is missing from .env.local');

  const api = createApiClient(prodUrl, apiKey);

  console.info(`▶ Content sweep against ${prodUrl}`);
  console.info(
    `  fact-check: ${options.skipFactCheck ? 'skip' : 'run'} · duplicates: ${options.skipDuplicates ? 'skip' : 'run'}`
  );

  console.info('▶ Fetching question corpus…');
  const questions = await fetchAllQuestions(api);
  console.info(`  fetched ${questions.length} question(s)`);

  console.info('▶ Running full quality sweep (static + duplicates + fact-check)…');
  const startedAt = Date.now();
  const sweep = await api.post<QualitySweepReport>('/api/admin/quality-sweep', {
    skipFactCheck: options.skipFactCheck,
    skipDuplicates: options.skipDuplicates,
  });
  const durationSeconds = (Date.now() - startedAt) / 1000;
  console.info(`  sweep complete in ${Math.round(durationSeconds)}s`);

  console.info(
    '▶ Running new static checks (false-nationality framing, missing acceptableAnswers)…'
  );
  const newFindings = runNewChecks(questions);
  console.info(`  ${newFindings.length} new finding(s)`);

  const report = buildReport({ prodUrl, durationSeconds, sweep, questions, newFindings, options });

  await mkdir(OUTPUT_DIR, { recursive: true });
  const stamp = dateStamp();
  const jsonPath = path.join(OUTPUT_DIR, `content-sweep-report-${stamp}.json`);
  const mdPath = path.join(OUTPUT_DIR, `content-sweep-summary-${stamp}.md`);

  await writeFile(jsonPath, JSON.stringify(report, null, 2), 'utf8');
  await writeFile(mdPath, renderMarkdown(report), 'utf8');

  console.info('');
  console.info('✔ Sweep finished. Reports written (answers redacted):');
  console.info(`  JSON:     ${path.relative(PROJECT_ROOT, jsonPath)}`);
  console.info(`  Markdown: ${path.relative(PROJECT_ROOT, mdPath)}`);
  console.info('');
  console.info(
    `  Triage → auto-fix: ${report.summary.byBucket['auto-fix']} · ` +
      `needs-review: ${report.summary.byBucket['needs-review']} · ` +
      `dismiss: ${report.summary.byBucket.dismiss}`
  );
}

main().catch((error) => {
  console.error('Content sweep failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
