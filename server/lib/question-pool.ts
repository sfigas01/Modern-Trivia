// Shared 3-tier question preference ordering (STE-138), built on top of the
// escalating cooldown cycle from STE-120 (1 -> 3 -> 5 months, repeating).
//
// A game must always be able to start if approved questions exist, so
// candidates are never hard-excluded for being in cooldown -- they are only
// deprioritized:
//   Tier 0: never seen by this user
//   Tier 1: seen before, but the cooldown window has elapsed
//   Tier 2: seen before and still within the cooldown window (last resort,
//           soonest-to-expire first)
import { sql, type SQL } from 'drizzle-orm';
import { questions, seenQuestions } from '@shared/schema';

export const cooldownIntervalExpr = sql`
  CASE (${seenQuestions.seenCount} - 1) % 3
    WHEN 0 THEN INTERVAL '1 month'
    WHEN 1 THEN INTERVAL '3 months'
    WHEN 2 THEN INTERVAL '5 months'
  END
`;

export const cooldownExpiresAtExpr = sql`${seenQuestions.seenAt} + ${cooldownIntervalExpr}`;

export const questionTierExpr = sql<number>`
  CASE
    WHEN ${seenQuestions.questionId} IS NULL THEN 0
    WHEN ${cooldownExpiresAtExpr} <= NOW() THEN 1
    ELSE 2
  END::int
`;

/**
 * Room-wide preference tier for multiplayer selection (STE-273). A room can
 * have several signed-in players (each with their own seen_questions history)
 * plus guests (who supply a flat locally-seen id list with no cooldown data).
 *
 * The query joins seen_questions for every signed-in player in the room, so a
 * question may match multiple rows — one per player who has seen it. Grouping
 * by question id and taking the worst (highest) per-player tier gives the
 * room's tier: a question is only tier 0 (never-seen) if NO participant has
 * seen it, and drops to tier 2 if it is still in cooldown for anyone.
 * Guest-seen ids have no cooldown, so they are treated as tier 1
 * (previously-seen but eligible), which keeps them out of play while
 * never-seen supply lasts without ever hard-excluding them.
 *
 * `guestSeenCondition` is an already-built `inArray(questions.id, ids)` (or
 * omitted when there are no guest ids).
 */
export function roomQuestionTierExpr(guestSeenCondition?: SQL): SQL<number> {
  const guestTier = guestSeenCondition
    ? sql<number>`CASE WHEN ${guestSeenCondition} THEN 1 ELSE 0 END`
    : sql<number>`0`;
  return sql<number>`GREATEST(MAX(${questionTierExpr}), ${guestTier})`;
}

/**
 * When a question becomes eligible for the WHOLE room again, for last-resort
 * ordering of tier-2 (still-in-cooldown) questions. The room tier is the worst
 * (highest) per-player tier, so eligibility is gated by the LAST cooldown to
 * clear — i.e. the maximum expiry across the room's players, not the earliest.
 * Using MIN here would let an already-expired participant make a question whose
 * other cooldown lasts months sort ahead of one clearing tomorrow.
 */
export const roomEligibleAtExpr = sql`MAX(${cooldownExpiresAtExpr})`;

/**
 * 1-based position of a question within the room's unioned guest-seen list, or
 * NULL when it is not guest-seen. `getGuestSeenIds()` stores ids oldest-first,
 * so ordering by this ascending preserves the oldest-first fallback the
 * per-guest path guaranteed (a newer-seen question is never replayed while an
 * older one is still available). NULLs sort last under ASC, keeping non-guest
 * questions unaffected.
 */
export function roomGuestSeenOrdinalExpr(guestSeenIds: string[]): SQL<number | null> {
  // Build ARRAY[$1, $2, ...]::text[] explicitly: interpolating the JS array
  // directly makes drizzle emit a row constructor `($1, $2, ...)`, which is not
  // a valid array argument to array_position.
  const arrayLiteral = sql`ARRAY[${sql.join(
    guestSeenIds.map((id) => sql`${id}`),
    sql`, `
  )}]::text[]`;
  return sql<number | null>`array_position(${arrayLiteral}, ${questions.id}::text)`;
}

// Upper bound on the unioned guest exclusion list passed to a single room-start
// query. Each player's list is already capped at 500 (schema), so with the
// 4-player room cap this is only a defensive ceiling.
export const ROOM_GUEST_SEEN_CAP = 2000;

const TIER_LABELS = ['never-seen', 'cooldown-expired', 'in-cooldown'] as const;

/**
 * Logs a warning when the selected pool had to reach past never-seen
 * questions (tier 0) into cooldown-expired or still-in-cooldown ones, so
 * unexpectedly small pools are observable in server logs.
 */
export function logQuestionPoolBackfill(context: string, tiers: number[]): void {
  const counts = [0, 0, 0];
  for (const tier of tiers) {
    if (tier >= 0 && tier <= 2) counts[tier] += 1;
  }
  if (counts[1] === 0 && counts[2] === 0) return;

  const breakdown = TIER_LABELS.map((label, tier) => `${label}=${counts[tier]}`).join(', ');
  console.warn(`[question-pool] ${context}: backfilled from cooldown pool (${breakdown})`);
}
