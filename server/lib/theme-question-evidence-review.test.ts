import { describe, expect, it } from 'vitest';

import {
  evaluateLatestThemeQuestionEvidenceReview,
  isIndependentThemeQuestionReviewer,
} from './theme-question-evidence-review';

const now = new Date('2026-09-30T12:00:00.000Z');
const id = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

describe('S8a newest question evidence attempt', () => {
  // The graph is intentionally malformed: the selector must withhold pending and failed
  // attempts before a prior pass can reach the pure evidence kernel.
  const graph = {} as Parameters<typeof evaluateLatestThemeQuestionEvidenceReview>[0];
  const priorPass = { id: id(1), sequence: 1, outcome: { status: 'reviewed', review: {} } };

  it('withholds when no attempt exists', () => {
    expect(evaluateLatestThemeQuestionEvidenceReview(graph, [], now)).toMatchObject({
      eligible: false,
      reason: 'missing_or_invalid_attempt',
      attemptId: null,
    });
  });

  it('does not fall back to an older pass while the newest attempt is unresolved', () => {
    expect(
      evaluateLatestThemeQuestionEvidenceReview(
        graph,
        [priorPass, { id: id(2), sequence: 2, outcome: null }],
        now
      )
    ).toMatchObject({ eligible: false, reason: 'latest_attempt_not_reviewed', attemptId: id(2) });
  });

  it('does not fall back after a terminal failure or an adverse result', () => {
    for (const status of ['failed', 'invalid_output', 'ineligible']) {
      expect(
        evaluateLatestThemeQuestionEvidenceReview(
          graph,
          [priorPass, { id: id(2), sequence: 2, outcome: { status, review: null } }],
          now
        )
      ).toMatchObject({ eligible: false, reason: 'latest_attempt_not_reviewed', attemptId: id(2) });
    }
  });

  it('rejects ambiguous sequences and sends the selected completed review through the kernel', () => {
    expect(
      evaluateLatestThemeQuestionEvidenceReview(
        graph,
        [priorPass, { id: id(2), sequence: 1, outcome: null }],
        now
      )
    ).toMatchObject({ eligible: false, reason: 'missing_or_invalid_attempt' });
    expect(evaluateLatestThemeQuestionEvidenceReview(graph, [priorPass], now)).toMatchObject({
      eligible: false,
      reason: 'malformed_input',
      attemptId: id(1),
    });
  });
});

describe('S8a reviewer independence', () => {
  const reviewer = {
    kind: 'model' as const,
    id: 'reviewer',
    provider: 'provider-b',
    model: 'model-b',
  };
  const predecessor = {
    id: 'writer',
    executionId: id(3),
    kind: 'model',
    provider: 'provider-a',
    model: 'model-a',
  };

  it('requires separate identity, execution, and model pair from each predecessor', () => {
    expect(isIndependentThemeQuestionReviewer(reviewer, id(4), predecessor)).toBe(true);
    expect(
      isIndependentThemeQuestionReviewer({ ...reviewer, id: 'writer' }, id(4), predecessor)
    ).toBe(false);
    expect(isIndependentThemeQuestionReviewer(reviewer, id(3), predecessor)).toBe(false);
    expect(
      isIndependentThemeQuestionReviewer(
        { ...reviewer, provider: 'provider-a', model: 'model-a' },
        id(4),
        predecessor
      )
    ).toBe(false);
  });
});
