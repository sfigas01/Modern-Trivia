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

  const combined = [...existing, ...(batch as unknown as Question[])];

  // Constrain pair iteration to "at least one batch id" — we don't care about
  // existing-vs-existing collisions here (owned by STE-143 / offline cleanup),
  // and skipping them is O((E+B)^2) → O(B*(E+B)) work.
  const report = await detectDuplicates(combined, { scopeIds: batchIds });

  // For each batch id, record the strongest reason it should be dropped.
  const dropDecisions = new Map<string, DroppedNovelty<T>>();

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

  function record(targetId: string, candidate: DroppedNovelty<T>) {
    const existingDecision = dropDecisions.get(targetId);
    if (!existingDecision) {
      dropDecisions.set(targetId, candidate);
      return;
    }
    // Prefer existing-collision over within-batch (existing rules are stricter),
    // then prefer stronger match types, then prefer higher similarity.
    if (
      candidate.reason === 'duplicate_of_existing' &&
      existingDecision.reason === 'duplicate_within_batch'
    ) {
      dropDecisions.set(targetId, candidate);
      return;
    }
    if (
      candidate.reason === existingDecision.reason &&
      isStrongerMatch(candidate.matchType, existingDecision.matchType)
    ) {
      dropDecisions.set(targetId, candidate);
      return;
    }
    if (
      candidate.reason === existingDecision.reason &&
      candidate.matchType === existingDecision.matchType &&
      candidate.similarityScore > existingDecision.similarityScore
    ) {
      dropDecisions.set(targetId, candidate);
    }
  }

  for (const match of report.duplicatesFound) {
    const aInBatch = batchIds.has(match.questionIdA);
    const bInBatch = batchIds.has(match.questionIdB);

    if (aInBatch && bInBatch) {
      // Within-batch collision — keep the earlier one, drop the later one.
      const aOrder = batchOrder.get(match.questionIdA) ?? 0;
      const bOrder = batchOrder.get(match.questionIdB) ?? 0;
      const dropId = aOrder <= bOrder ? match.questionIdB : match.questionIdA;
      const keepId = dropId === match.questionIdA ? match.questionIdB : match.questionIdA;
      const dropped = batch.find((q) => q.id === dropId);
      if (!dropped) continue;
      record(dropId, {
        question: dropped,
        reason: 'duplicate_within_batch',
        matchType: match.matchType,
        similarityScore: match.similarityScore,
        matchedBatchId: keepId,
      });
      continue;
    }

    if (aInBatch || bInBatch) {
      const batchId = aInBatch ? match.questionIdA : match.questionIdB;
      const existingId = aInBatch ? match.questionIdB : match.questionIdA;
      const dropped = batch.find((q) => q.id === batchId);
      if (!dropped) continue;
      record(batchId, {
        question: dropped,
        reason: 'duplicate_of_existing',
        matchType: match.matchType,
        similarityScore: match.similarityScore,
        matchedExistingId: existingId,
      });
    }
    // If neither id is in the batch, the collision is between two existing rows —
    // not our concern here (owned by STE-143 / offline cleanup).
  }

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
