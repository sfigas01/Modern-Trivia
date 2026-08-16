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
import { sql } from 'drizzle-orm';
import { seenQuestions } from '@shared/schema';

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
