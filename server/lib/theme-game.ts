// Themed games — STE-167 LEAN MVP.
//
// Self-contained helpers for on-demand, player-requested themed games. This is
// the minimum playable slice: reuse eligible approved questions for a theme,
// then generate the remainder through the EXISTING Guardian pipeline
// (generateQuestions + filterNovelQuestions), persist accepted questions as
// approved `player_ai` rows so they enrich the shared library, and select a
// full-length, theme-leaning game.
//
// Deliberately NOT built here (belongs to the STE-167 full plan): durable jobs
// & crash recovery, atomic reservations, the 30-day/last-5-games eligibility
// system, two-rounds-ahead replenishment, cost telemetry/global budgets. This
// module reuses the existing seen-question tracking (STE-81 / STE-273) as-is
// and keeps a best-effort in-memory progress store for the waiting UX.

import OpenAI from 'openai';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';

import { db } from '../db';
import {
  questions,
  seenQuestions,
  rooms,
  roomPlayers,
  type Room,
  type RoomPlayer,
  type RoomCategories,
  type RoomCategory,
} from '@shared/schema';
import { VALID_CATEGORIES } from '@shared/constants/categories';
import { QUESTIONS_PER_TEAM_ROTATION } from '@shared/lib/answers';
import type { ThemeProgress } from '@shared/models/rooms';

import { TRIVIA_AI_REQUEST_CONFIG } from './ai-model-config';
import {
  generateQuestions,
  isEligibleForAutomaticApproval,
  type ExistingExample,
  type QuestionAiAnalysis,
} from './guardian';
import { filterNovelQuestions, SemanticCheckIncompleteError } from './novelty-filter';
import { selectTopicContext } from './topic-context';
import {
  roomQuestionTierExpr,
  roomEligibleAtExpr,
  roomGuestSeenOrdinalExpr,
  ROOM_GUEST_SEEN_CAP,
  logQuestionPoolBackfill,
} from './question-pool';

// --- Feature flag ---------------------------------------------------------

// Gate the entire feature behind VITE_THEME_ROUNDS (same flag name the full
// plan uses). Read at call time so tests can toggle it. Flag off ⇒ theme
// endpoints behave as if absent and ordinary flows are untouched.
export function isThemeRoundsEnabled(): boolean {
  return process.env.VITE_THEME_ROUNDS === 'true';
}

// --- Theme normalization --------------------------------------------------

const THEME_TAG_PREFIX = 'theme:';
const MAX_SLUG_LENGTH = 80;

/**
 * Normalize free-text theme display text into a stable slug (Unicode letters
 * and digits, lowercased, dash-joined). Used for the theme tag so reuse and
 * generation share one key.
 */
export function normalizeThemeSlug(theme: string): string {
  const base = theme
    .normalize('NFKD')
    // Strip combining marks so accented letters fold to their base form.
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
  const ascii = base
    // Collapse any run of non-alphanumeric characters into a single dash.
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH);
  if (ascii) return ascii;
  // A theme with no ASCII letters/digits (e.g. "日本史") would otherwise collapse
  // to an empty slug, so every such theme would share the tag `theme:` and
  // mis-reuse each other's questions. Derive a stable, distinct key from the
  // code points instead.
  const hex = Array.from(base.replace(/\s+/g, ''))
    .map((ch) => (ch.codePointAt(0) ?? 0).toString(16))
    .join('-');
  return `u-${hex}`.slice(0, MAX_SLUG_LENGTH);
}

/** Tag applied to every question that belongs to a theme (reused or generated). */
export function themeTag(theme: string): string {
  return `${THEME_TAG_PREFIX}${normalizeThemeSlug(theme)}`;
}

// --- Cost guard -----------------------------------------------------------

// Simple per-game candidate ceiling (cost guard). We never ask the pipeline to
// produce more than this many candidates for a single themed game, regardless
// of attrition. Paired with the existing aiLimiter on the routes.
export const THEME_MAX_GENERATED_CANDIDATES = 120;
// Guardian caps a single generateQuestions call at 20; keep batches modest so
// review overlaps generation and progress advances in visible steps.
export const THEME_GENERATION_BATCH_SIZE = 10;
// Defensive bound on generate calls per game (belt-and-suspenders with the
// candidate ceiling above).
export const THEME_MAX_BATCHES = 20;

const VALID_PILLARS = ['GlobalEh', 'FreshPrints', 'TimeCapsule', 'GreatOutdoors'] as const;
const THEMED_AUTO_APPROVAL_POLICY = 'themed-strict-v1';

/** Questions a full themed game needs: numRounds × teams × 4 (same math as /start). */
export function themedQuestionLimit(numRounds: number, playerCount: number): number {
  return numRounds * playerCount * QUESTIONS_PER_TEAM_ROTATION;
}

// --- Category suggestion --------------------------------------------------

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

// Lightweight keyword → category heuristic, used as the deterministic fallback
// when the model call is unavailable or returns nothing usable. Order matters
// only for readability; all matches are unioned.
const CATEGORY_KEYWORDS: Array<{ category: RoomCategory; words: string[] }> = [
  {
    category: 'Sports',
    words: ['sport', 'baseball', 'hockey', 'soccer', 'football', 'basketball', 'olympic', 'tennis'],
  },
  {
    category: 'Science & Nature',
    words: ['science', 'chemistry', 'biology', 'physics', 'space', 'animal', 'nature', 'math'],
  },
  {
    category: 'Entertainment & Pop Culture',
    words: ['movie', 'film', 'tv', 'television', 'music', 'celebrity', 'friends', 'show', 'game'],
  },
  {
    category: 'Food & Culture',
    words: ['food', 'cook', 'cuisine', 'recipe', 'drink', 'wine', 'culture', 'holiday'],
  },
  {
    category: 'Technology',
    words: ['tech', 'computer', 'software', 'internet', 'ai', 'robot', 'gadget', 'phone'],
  },
  {
    category: 'History & Geography',
    words: ['history', 'war', 'ancient', 'country', 'geography', 'capital', 'map', 'empire'],
  },
];

export function fallbackThemeCategories(theme: string): RoomCategory[] {
  const lower = theme.toLowerCase();
  const matched = CATEGORY_KEYWORDS.filter(({ words }) => words.some((w) => lower.includes(w))).map(
    ({ category }) => category
  );
  // Always return at least one suggestion so the host has something to adjust.
  return matched.length > 0 ? Array.from(new Set(matched)) : ['History & Geography'];
}

/**
 * Suggest related canonical categories for a free-text theme. Uses a small
 * model call, always with a deterministic keyword fallback so the setup flow
 * never blocks on the AI. Only canonical category values are ever returned.
 */
export async function suggestThemeCategories(theme: string): Promise<RoomCategory[]> {
  try {
    const response = await getOpenAI().chat.completions.create({
      ...TRIVIA_AI_REQUEST_CONFIG,
      messages: [
        {
          role: 'system',
          content:
            'You map a trivia theme to the most relevant canonical categories. Always return valid JSON matching the requested schema.',
        },
        {
          role: 'user',
          content: `Theme: "${theme}"

Choose 1–3 categories from this exact list that best fit trivia questions about this theme:
${VALID_CATEGORIES.map((c) => `- ${c}`).join('\n')}

Return only valid JSON: { "categories": ["<one of the exact category strings above>"] }`,
        },
      ],
      response_format: { type: 'json_object' },
      max_completion_tokens: 256,
    });

    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content) as { categories?: unknown };
    const raw = Array.isArray(parsed.categories) ? parsed.categories : [];
    const valid = raw.filter(
      (c): c is RoomCategory =>
        typeof c === 'string' && (VALID_CATEGORIES as readonly string[]).includes(c)
    );
    const unique = Array.from(new Set(valid));
    if (unique.length > 0) return unique.slice(0, 3);
    console.warn('[theme-game] Category suggestion returned nothing usable — using fallback', {
      theme,
    });
    return fallbackThemeCategories(theme);
  } catch (error) {
    console.error('[theme-game] Category suggestion failed — using fallback', { theme, error });
    return fallbackThemeCategories(theme);
  }
}

// --- Seen-question inputs (reuse STE-273 logic as-is) ---------------------

interface RoomSeenInputs {
  roomUserIds: string[];
  guestSeenUnion: string[];
}

/**
 * Build the room-wide seen inputs exactly as POST /api/rooms/:code/start does:
 * union every signed-in player's server history plus every guest's locally-seen
 * list. `hostIsGuest` decides whether the host's fresh start-payload exclusion
 * list is trusted (guest host) or ignored (authenticated host is
 * server-authoritative).
 */
export function computeRoomSeenInputs(
  players: RoomPlayer[],
  excludeQuestionIds: string[],
  hostIsGuest: boolean
): RoomSeenInputs {
  const roomUserIds = Array.from(
    new Set(players.map((p) => p.userId).filter((id): id is string => !!id))
  );

  const guestSeenSet = new Set<string>();
  for (const player of players) {
    if (!player.userId && player.guestSeenIds) {
      for (const id of player.guestSeenIds) guestSeenSet.add(id);
    }
  }
  if (hostIsGuest) {
    for (const id of excludeQuestionIds) guestSeenSet.add(id);
  }

  let guestSeenUnion = Array.from(guestSeenSet);
  if (guestSeenUnion.length > ROOM_GUEST_SEEN_CAP) {
    console.warn(
      `[theme-game] themed start: guest exclusion union of ${guestSeenUnion.length} ` +
        `exceeded cap ${ROOM_GUEST_SEEN_CAP}; truncating`
    );
    guestSeenUnion = guestSeenUnion.slice(0, ROOM_GUEST_SEEN_CAP);
  }

  return { roomUserIds, guestSeenUnion };
}

function categoryCondition(categories: RoomCategories): SQL | undefined {
  if (categories.includes('All')) return undefined;
  if (categories.length === 1) return eq(questions.category, categories[0]);
  return inArray(questions.category, categories as string[]);
}

/**
 * Room-wide, seen-tier-ordered selection over approved questions matching the
 * supplied extra conditions (theme tag and/or category). Mirrors the ordering
 * in POST /api/rooms/:code/start so repeat protection is identical (STE-273):
 * never-seen first, then guest FIFO, then soonest room-eligible, then random.
 */
async function selectApprovedQuestionIds(
  extraConditions: SQL[],
  seen: RoomSeenInputs,
  limit: number,
  context: string
): Promise<string[]> {
  if (limit <= 0) return [];

  const { roomUserIds, guestSeenUnion } = seen;
  const hasGuestSeen = guestSeenUnion.length > 0;
  const guestSeenCondition = hasGuestSeen ? inArray(questions.id, guestSeenUnion) : undefined;
  const roomTierExpr = roomQuestionTierExpr(guestSeenCondition);
  const seenJoinCondition = and(
    eq(questions.id, seenQuestions.questionId),
    roomUserIds.length > 0 ? inArray(seenQuestions.userId, roomUserIds) : sql`false`
  );

  const orderBy: SQL[] = [roomTierExpr];
  if (hasGuestSeen) orderBy.push(roomGuestSeenOrdinalExpr(guestSeenUnion));
  orderBy.push(roomEligibleAtExpr, sql`random()`);

  const rows = await db
    .select({ id: questions.id, tier: roomTierExpr })
    .from(questions)
    .leftJoin(seenQuestions, seenJoinCondition)
    .where(and(eq(questions.status, 'approved'), ...extraConditions))
    .groupBy(questions.id)
    .orderBy(...orderBy)
    .limit(limit);

  logQuestionPoolBackfill(
    context,
    rows.map((r) => r.tier)
  );
  return rows.map((r) => r.id);
}

// --- In-memory progress store (best-effort) -------------------------------

// Retention for progress entries. Best-effort only (no durable jobs); entries
// are pruned lazily so the process-global map can't grow without bound on a
// long-running server even though nothing calls clearThemeProgress in the
// terminal (ready/error) path.
export const THEME_PROGRESS_TTL_MS = 30 * 60 * 1000;

interface ProgressEntry {
  progress: ThemeProgress;
  touchedAt: number;
}

const progressByRoom = new Map<string, ProgressEntry>();

function pruneExpiredProgress(now = Date.now()): void {
  const expired: string[] = [];
  progressByRoom.forEach((entry, code) => {
    if (now - entry.touchedAt > THEME_PROGRESS_TTL_MS) expired.push(code);
  });
  for (const code of expired) progressByRoom.delete(code);
}

export function initThemeProgress(code: string, total: number): ThemeProgress {
  pruneExpiredProgress();
  const progress: ThemeProgress = {
    status: 'preparing',
    ready: 0,
    total,
    reused: 0,
    generated: 0,
    error: null,
  };
  progressByRoom.set(code, { progress, touchedAt: Date.now() });
  return progress;
}

export function updateThemeProgress(code: string, patch: Partial<ThemeProgress>): void {
  const entry = progressByRoom.get(code);
  if (!entry) return;
  entry.progress = { ...entry.progress, ...patch };
  entry.touchedAt = Date.now();
  pruneExpiredProgress();
}

export function getThemeProgress(code: string): ThemeProgress | undefined {
  const entry = progressByRoom.get(code);
  if (!entry) return undefined;
  if (Date.now() - entry.touchedAt > THEME_PROGRESS_TTL_MS) {
    progressByRoom.delete(code);
    return undefined;
  }
  return entry.progress;
}

export function clearThemeProgress(code: string): void {
  progressByRoom.delete(code);
}

// --- Themed sourcing ------------------------------------------------------

export interface PrepareThemedResult {
  questionIds: string[];
  reused: number;
  generated: number;
}

interface ExistingRow {
  id: string;
  question: string;
  answer: string;
  pillar: string;
}

/**
 * Source a full-length, theme-leaning set of question ids for a themed game.
 *
 * 1. Reuse eligible approved questions already tagged with this theme.
 * 2. Generate the remainder via the existing Guardian pipeline, novelty-filter
 *    it, and persist accepted questions as approved `player_ai` rows (shared
 *    library). Bounded by the per-game candidate ceiling.
 *
 * `onStep` reports incremental progress for the waiting UX.
 */
export async function prepareThemedQuestions(params: {
  theme: string;
  categories: RoomCategories;
  numRounds: number;
  playerCount: number;
  seen: RoomSeenInputs;
  onStep?: (patch: Partial<ThemeProgress>) => void;
}): Promise<PrepareThemedResult> {
  const { theme, categories, numRounds, playerCount, seen, onStep } = params;
  const total = themedQuestionLimit(numRounds, playerCount);
  const tag = themeTag(theme);
  const notify = (patch: Partial<ThemeProgress>) => onStep?.(patch);

  const tagContains = sql`${questions.tags} @> ${JSON.stringify([tag])}::jsonb`;
  const catCond = categoryCondition(categories);

  // Step 1: reuse existing approved questions already tagged with this theme.
  // Legacy themed player_ai rows may have been approved before the unattended
  // approval gate existed. Do not silently reuse review-needed rows. Curated
  // rows remain eligible because their provenance implies human review.
  const safeThemedRow = sql`(
    ${questions.origin} <> 'player_ai'
    OR (
      ${questions.aiAnalysis}->'factCheck'->>'verdict' = 'pass'
      AND ${questions.aiAnalysis}->'factCheck'->>'coherence' = 'pass'
      AND ${questions.aiAnalysis}->'factCheck'->>'obviousness' = 'pass'
      AND COALESCE((${questions.aiAnalysis}->'factCheck'->>'confidence')::numeric, 0) >= 80
      AND ${questions.aiAnalysis}->>'automaticApprovalPolicy' = ${THEMED_AUTO_APPROVAL_POLICY}
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(COALESCE(${questions.aiAnalysis}->'qaFindings', '[]'::jsonb)) AS finding
        WHERE finding->>'severity' IN ('high', 'medium')
      )
    )
  )`;
  const reuseConditions = catCond ? [tagContains, catCond, safeThemedRow] : [tagContains, safeThemedRow];
  const reusedThemedIds = await selectApprovedQuestionIds(
    reuseConditions,
    seen,
    total,
    'themed start reuse'
  );
  const chosen = new Set<string>(reusedThemedIds);
  notify({ reused: reusedThemedIds.length, ready: chosen.size });

  // Existing pool for negative examples + novelty filtering. Only the columns
  // the downstream consumers read (topic context + novelty filter).
  const existingPool = (await db
    .select({
      id: questions.id,
      question: questions.question,
      answer: questions.answer,
      pillar: questions.pillar,
    })
    .from(questions)
    .where(sql`${questions.status} IN ('approved', 'pending')`)) as ExistingRow[];

  // Step 2: generate the remainder, bounded by the candidate ceiling.
  const generatedIds: string[] = [];
  let candidatesRequested = 0;
  let batchIndex = 0;
  const acceptedForNovelty: ExistingRow[] = [];

  while (
    chosen.size < total &&
    candidatesRequested < THEME_MAX_GENERATED_CANDIDATES &&
    batchIndex < THEME_MAX_BATCHES
  ) {
    const shortfall = total - chosen.size;
    const remainingCeiling = THEME_MAX_GENERATED_CANDIDATES - candidatesRequested;
    const batchCount = Math.min(shortfall, THEME_GENERATION_BATCH_SIZE, remainingCeiling);
    if (batchCount <= 0) break;

    // Rotate pillars across batches for variety in the shared library.
    const pillar = VALID_PILLARS[batchIndex % VALID_PILLARS.length];
    candidatesRequested += batchCount;
    batchIndex += 1;

    let kept: Awaited<ReturnType<typeof generateQuestions>> = [];
    try {
      const ctx: ExistingExample[] = selectTopicContext({
        topic: theme,
        pillar,
        existing: [...existingPool, ...acceptedForNovelty],
      });
      const generated = await generateQuestions(theme, batchCount, pillar, ctx);
      const noveltyExisting = [...existingPool, ...acceptedForNovelty].map((q) => ({
        id: q.id,
        question: q.question,
        answer: q.answer,
      }));
      const result = await filterNovelQuestions(generated, noveltyExisting);
      kept = result.kept;
    } catch (error) {
      if (error instanceof SemanticCheckIncompleteError) {
        console.error('[theme-game] Semantic novelty check failed — aborting preparation', {
          theme,
          pillar,
          batchIndex,
          category: error.category,
          failedPairs: error.failedPairs,
        });
        throw error;
      }
      console.error('[theme-game] Generation batch failed — continuing', {
        theme,
        pillar,
        batchIndex,
        error,
      });
      continue;
    }

    if (kept.length === 0) continue;

    // Guardian's normal contract is "pending candidates": a flag is retained
    // for human review and only hard failures are repaired/dropped. Themed
    // generation has no human in the loop, so only explicitly clean, confident
    // candidates can be auto-approved.
    const autoApprovable = kept.filter(
      (question) =>
        isEligibleForAutomaticApproval(question) &&
        (categories.includes('All') || categories.includes(question.category as RoomCategory))
    );
    if (autoApprovable.length !== kept.length) {
      console.warn('[theme-game] Withholding generated candidates from automatic approval', {
        theme,
        pillar,
        batchIndex,
        kept: kept.length,
        withheld: kept.length - autoApprovable.length,
      });
    }
    if (autoApprovable.length === 0) continue;

    // Persist accepted questions as approved `player_ai` rows so they enrich the
    // shared library for everyone. Tag with the theme so future games reuse them.
    const toInsert = autoApprovable.map((q) => ({
      ...q,
      status: 'approved' as const,
      origin: 'player_ai' as const,
      tags: Array.from(new Set([...(q.tags ?? []), tag])),
      aiAnalysis: {
        ...(q.aiAnalysis as QuestionAiAnalysis),
        automaticApprovalPolicy: THEMED_AUTO_APPROVAL_POLICY,
      },
    }));

    const inserted = await db.insert(questions).values(toInsert).returning({
      id: questions.id,
      question: questions.question,
      answer: questions.answer,
      pillar: questions.pillar,
    });

    for (const row of inserted) {
      if (chosen.has(row.id)) continue;
      chosen.add(row.id);
      generatedIds.push(row.id);
      acceptedForNovelty.push(row as ExistingRow);
      if (chosen.size >= total) break;
    }

    notify({ generated: generatedIds.length, ready: chosen.size });
  }

  // Do not disguise generic category inventory as themed content. If strict
  // generation attrition leaves the set short, the orchestrator reports that
  // honestly and leaves the room in the lobby.
  const ordered = [...generatedIds, ...reusedThemedIds].slice(0, total);

  return {
    questionIds: ordered,
    reused: reusedThemedIds.length,
    generated: generatedIds.length,
  };
}

// --- Orchestrator ---------------------------------------------------------

/**
 * Best-effort background preparation: source themed questions, then transition
 * the lobby room to active. Updates the in-memory progress store throughout so
 * the client can poll "generating… X of N ready". On failure the room stays in
 * the lobby and the host can retry. No durable jobs / recovery (full plan).
 */
export async function runThemedGamePreparation(params: {
  room: Room;
  players: RoomPlayer[];
  categories: RoomCategories;
  theme: string;
  hostPlayerId: string;
  seen: RoomSeenInputs;
}): Promise<void> {
  const { room, players, categories, theme, hostPlayerId, seen } = params;
  const total = themedQuestionLimit(room.numRounds, players.length);

  try {
    const result = await prepareThemedQuestions({
      theme,
      categories,
      numRounds: room.numRounds,
      playerCount: players.length,
      seen,
      onStep: (patch) => updateThemeProgress(room.code, patch),
    });

    if (result.questionIds.length < total) {
      updateThemeProgress(room.code, {
        status: 'error',
        error: `Could only assemble ${result.questionIds.length} of ${total} questions for "${theme}". Try a broader theme, different categories, or fewer rounds.`,
      });
      return;
    }

    // Activate atomically, re-reading the CURRENT roster under a row lock:
    // players may have joined or left during the (potentially long) generation,
    // and the sizing/first-player were computed from the roster at start time.
    // A stale snapshot could otherwise begin a one-player game or seat a
    // departed player first. Recompute against the live roster; if it grew past
    // what we sourced, fail so the host retries rather than starting short.
    const activeTtlMs = 24 * 60 * 60 * 1000;
    const activation = await db.transaction(async (tx) => {
      const [lockedRoom] = await tx
        .select()
        .from(rooms)
        .where(eq(rooms.id, room.id))
        .limit(1)
        .for('update');
      if (!lockedRoom || lockedRoom.status !== 'lobby' || lockedRoom.phase !== 'LOBBY') {
        return {
          ok: false as const,
          reason: 'Room state changed before the themed game could start.',
        };
      }

      const currentPlayers = await tx
        .select()
        .from(roomPlayers)
        .where(and(eq(roomPlayers.roomId, room.id), isNull(roomPlayers.leftAt)))
        .orderBy(asc(roomPlayers.joinOrder));

      if (currentPlayers.length < 2) {
        return { ok: false as const, reason: 'At least two players are required to start.' };
      }

      const required = themedQuestionLimit(lockedRoom.numRounds, currentPlayers.length);
      if (result.questionIds.length < required) {
        return {
          ok: false as const,
          reason: `Players joined while preparing "${theme}"; only ${result.questionIds.length} of ${required} questions are ready. Please start again.`,
        };
      }

      const [startedRoom] = await tx
        .update(rooms)
        .set({
          status: 'active',
          phase: 'QUESTION',
          questionIds: result.questionIds.slice(0, required),
          currentQuestionIndex: 0,
          activePlayerId: currentPlayers[0].id,
          currentAttempt: null,
          expiresAt: new Date(Date.now() + activeTtlMs),
          version: sql`${rooms.version} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(rooms.id, room.id),
            eq(rooms.status, 'lobby'),
            eq(rooms.phase, 'LOBBY'),
            eq(rooms.hostPlayerId, hostPlayerId)
          )
        )
        .returning({ id: rooms.id });

      if (!startedRoom) {
        return {
          ok: false as const,
          reason: 'Room state changed before the themed game could start.',
        };
      }
      return { ok: true as const, playerCount: currentPlayers.length };
    });

    if (!activation.ok) {
      updateThemeProgress(room.code, { status: 'error', error: activation.reason });
      return;
    }

    updateThemeProgress(room.code, {
      status: 'ready',
      ready: themedQuestionLimit(room.numRounds, activation.playerCount),
      reused: result.reused,
      generated: result.generated,
    });
  } catch (error) {
    if (error instanceof SemanticCheckIncompleteError) {
      console.error('[theme-game] Themed preparation stopped by semantic gate', {
        code: room.code,
        theme,
        category: error.category,
        failedPairs: error.failedPairs,
      });
      updateThemeProgress(room.code, {
        status: 'error',
        error:
          error.category === 'configuration' || error.category === 'authentication'
            ? 'Semantic novelty checking is unavailable because an embeddings-capable provider is not configured. Configure the embeddings provider and try again.'
            : 'Semantic novelty checking could not finish. No generated questions were approved. Please try again.',
      });
      return;
    }
    console.error('[theme-game] Themed preparation failed', { code: room.code, theme, error });
    updateThemeProgress(room.code, {
      status: 'error',
      error: 'Themed game preparation failed. Please try again.',
    });
  }
}
