import type { Question } from '@shared/models/questions';
import { detectDuplicates, type DuplicateMatch } from './duplicate-detector';

export interface DroppedNovelty<T> {
  question: T;
  reason: 'duplicate_within_batch' | 'duplicate_of_existing';
  matchType: DuplicateMatch['matchType'];
  similarityScore: number;
  matchedExistingId?: string;
  matchedBatchId?: string;
}

export interface NoveltyFilterResult<T> {
  kept: T[];
  dropped: DroppedNovelty<T>[];
}

type DetectableQuestion = Pick<Question, 'id' | 'question' | 'answer'> &
  Partial<Pick<Question, 'pillar'>>;

export async function filterNovelQuestions<T extends DetectableQuestion>(
  batch: T[],
  existing: Question[]
): Promise<NoveltyFilterResult<T>> {
  if (batch.length === 0) {
    return { kept: [], dropped: [] };
  }

  const batchIds = new Set(batch.map((q) => q.id));
  const batchOrder = new Map<string, number>(batch.map((q, i) => [q.id, i]));
  const batchById = new Map<string, T>(batch.map((q) => [q.id, q]));

  const combined = [...existing, ...(batch as unknown as Question[])];

  // Constrain pair iteration to "at least one batch id" — we don't care about
  // existing-vs-existing collisions here (owned by STE-143 / offline cleanup),
  // and skipping them is O((E+B)^2) → O(B*(E+B)) work.
  const report = await detectDuplicates(combined, { scopeIds: batchIds });

  function isStrongerMatch(
    a: DuplicateMatch['matchType'],
    b: DuplicateMatch['matchType']
  ): boolean {
    const rank: Record<DuplicateMatch['matchType'], number> = {
      exact: 3,
      near_duplicate: 2,
      conceptual: 1,
    };
    return rank[a] > rank[b];
  }

  function shouldReplace(prev: DroppedNovelty<T>, next: DroppedNovelty<T>): boolean {
    if (isStrongerMatch(next.matchType, prev.matchType)) return true;
    if (next.matchType === prev.matchType && next.similarityScore > prev.similarityScore) {
      return true;
    }
    return false;
  }

  // Pass 1: identify batch items that are duplicates of an existing DB row.
  // These are unconditionally dropped — the existing row is the canonical version.
  const droppedByExisting = new Map<string, DroppedNovelty<T>>();
  for (const match of report.duplicatesFound) {
    const aInBatch = batchIds.has(match.questionIdA);
    const bInBatch = batchIds.has(match.questionIdB);
    if (aInBatch === bInBatch) continue; // skip both-batch and both-existing

    const batchId = aInBatch ? match.questionIdA : match.questionIdB;
    const existingId = aInBatch ? match.questionIdB : match.questionIdA;
    const item = batchById.get(batchId);
    if (!item) continue;

    const candidate: DroppedNovelty<T> = {
      question: item,
      reason: 'duplicate_of_existing',
      matchType: match.matchType,
      similarityScore: match.similarityScore,
      matchedExistingId: existingId,
    };

    const prior = droppedByExisting.get(batchId);
    if (!prior || shouldReplace(prior, candidate)) {
      droppedByExisting.set(batchId, candidate);
    }
  }

  // Pass 2: within-batch matches. Only drop the loser when the winner is itself
  // surviving — i.e. not already dropped as a duplicate of existing. Otherwise
  // the loser was being removed solely because of a ghost that's about to be
  // removed itself, and should pass through.
  const droppedByBatch = new Map<string, DroppedNovelty<T>>();
  for (const match of report.duplicatesFound) {
    const aInBatch = batchIds.has(match.questionIdA);
    const bInBatch = batchIds.has(match.questionIdB);
    if (!aInBatch || !bInBatch) continue;

    const aOrder = batchOrder.get(match.questionIdA) ?? 0;
    const bOrder = batchOrder.get(match.questionIdB) ?? 0;
    const winnerId = aOrder <= bOrder ? match.questionIdA : match.questionIdB;
    const loserId = winnerId === match.questionIdA ? match.questionIdB : match.questionIdA;

    if (droppedByExisting.has(winnerId)) continue;
    if (droppedByExisting.has(loserId)) continue; // already accounted for with stronger reason

    const item = batchById.get(loserId);
    if (!item) continue;

    const candidate: DroppedNovelty<T> = {
      question: item,
      reason: 'duplicate_within_batch',
      matchType: match.matchType,
      similarityScore: match.similarityScore,
      matchedBatchId: winnerId,
    };

    const prior = droppedByBatch.get(loserId);
    if (!prior || shouldReplace(prior, candidate)) {
      droppedByBatch.set(loserId, candidate);
    }
  }

  const dropDecisions = new Map<string, DroppedNovelty<T>>();
  droppedByExisting.forEach((decision, id) => dropDecisions.set(id, decision));
  droppedByBatch.forEach((decision, id) => {
    if (!dropDecisions.has(id)) dropDecisions.set(id, decision);
  });

  const kept: T[] = [];
  const dropped: DroppedNovelty<T>[] = [];
  for (const q of batch) {
    const decision = dropDecisions.get(q.id);
    if (decision) {
      dropped.push(decision);
    } else {
      kept.push(q);
    }
  }

  return { kept, dropped };
}
