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
import { and, eq, inArray, notInArray, sql, type SQL } from 'drizzle-orm';

import { db } from '../db';
import {
  questions,
  seenQuestions,
  rooms,
  type Room,
  type RoomPlayer,
  type RoomCategories,
  type RoomCategory,
} from '@shared/schema';
import { VALID_CATEGORIES } from '@shared/constants/categories';
import { QUESTIONS_PER_TEAM_ROTATION } from '@shared/lib/answers';
import type { ThemeProgress } from '@shared/models/rooms';

import { TRIVIA_AI_REQUEST_CONFIG } from './ai-model-config';
import { generateQuestions, type ExistingExample } from './guardian';
import { filterNovelQuestions } from './novelty-filter';
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
  return (
    theme
      .normalize('NFKD')
      // Strip combining marks so accented letters fold to their base form, then
      // collapse any run of non-alphanumeric characters into a single dash.
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, MAX_SLUG_LENGTH)
  );
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

const progressByRoom = new Map<string, ThemeProgress>();

export function initThemeProgress(code: string, total: number): ThemeProgress {
  const progress: ThemeProgress = {
    status: 'preparing',
    ready: 0,
    total,
    reused: 0,
    generated: 0,
    error: null,
  };
  progressByRoom.set(code, progress);
  return progress;
}

export function updateThemeProgress(code: string, patch: Partial<ThemeProgress>): void {
  const current = progressByRoom.get(code);
  if (!current) return;
  progressByRoom.set(code, { ...current, ...patch });
}

export function getThemeProgress(code: string): ThemeProgress | undefined {
  return progressByRoom.get(code);
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
 * 3. If still short (generation attrition), top up from approved questions in
 *    the room's selected categories.
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
  const reuseConditions = catCond ? [tagContains, catCond] : [tagContains];
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
      console.error('[theme-game] Generation batch failed — continuing', {
        theme,
        pillar,
        batchIndex,
        error,
      });
      continue;
    }

    if (kept.length === 0) continue;

    // Persist accepted questions as approved `player_ai` rows so they enrich the
    // shared library for everyone. Tag with the theme so future games reuse them.
    const toInsert = kept.map((q) => ({
      ...q,
      status: 'approved' as const,
      origin: 'player_ai' as const,
      tags: Array.from(new Set([...(q.tags ?? []), tag])),
      aiAnalysis: q.aiAnalysis,
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

  // Step 3: top up from category reuse if generation underperformed.
  if (chosen.size < total) {
    const fillLimit = total - chosen.size;
    const excludeIds = Array.from(chosen);
    const fillConditions: SQL[] = [];
    if (catCond) fillConditions.push(catCond);
    if (excludeIds.length > 0) {
      fillConditions.push(notInArray(questions.id, excludeIds));
    }
    const fillIds = await selectApprovedQuestionIds(
      fillConditions,
      seen,
      fillLimit,
      'themed start fill'
    );
    for (const id of fillIds) {
      if (chosen.has(id)) continue;
      chosen.add(id);
    }
    notify({ ready: chosen.size });
  }

  // Theme-leaning play order: freshly generated (bespoke, never-seen) first,
  // then reused theme questions, then category fill. Deduped, truncated to
  // exactly the game length.
  const fillIds = Array.from(chosen).filter(
    (id) => !generatedIds.includes(id) && !reusedThemedIds.includes(id)
  );
  const ordered = [...generatedIds, ...reusedThemedIds, ...fillIds].slice(0, total);

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

    const activeTtlMs = 24 * 60 * 60 * 1000;
    const [startedRoom] = await db
      .update(rooms)
      .set({
        status: 'active',
        phase: 'QUESTION',
        questionIds: result.questionIds,
        currentQuestionIndex: 0,
        activePlayerId: players[0].id,
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
      updateThemeProgress(room.code, {
        status: 'error',
        error: 'Room state changed before the themed game could start.',
      });
      return;
    }

    updateThemeProgress(room.code, {
      status: 'ready',
      ready: total,
      reused: result.reused,
      generated: result.generated,
    });
  } catch (error) {
    console.error('[theme-game] Themed preparation failed', { code: room.code, theme, error });
    updateThemeProgress(room.code, {
      status: 'error',
      error: 'Themed game preparation failed. Please try again.',
    });
  }
}
