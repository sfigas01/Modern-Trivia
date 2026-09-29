import { describe, expect, it } from 'vitest';

import {
  aggregateThemeFactReviewVerdict,
  validateThemeFactReviewOutput,
  type ThemeFactReviewOutput,
} from './theme-fact-review';

const passageId = '40d45c59-3386-45cb-9f89-653970cb0907';
const passageHash = 'a'.repeat(64);

function output(): ThemeFactReviewOutput {
  const dimension = {
    verdict: 'pass' as const,
    reasons: ['supported'],
    passageRefs: [{ passageId, passageContentHash: passageHash }],
  };
  return {
    dimensions: {
      entailment: dimension,
      scope: { ...dimension, reasons: ['scope_match'] },
      canonical_answer: { ...dimension, reasons: ['answer_supported'] },
      aliases: { ...dimension, reasons: ['no_aliases'], passageRefs: [] },
      conflict: { ...dimension, reasons: ['no_conflict'] },
      source_independence: { ...dimension, reasons: ['independent_origins'] },
    },
  };
}

describe('theme fact review contract', () => {
  it('requires the six strict dimensions and exact known passage references', () => {
    const valid = output();
    expect(validateThemeFactReviewOutput(valid, [], new Map([[passageId, passageHash]]))).toEqual(
      valid
    );
    const missingDimension = { ...valid, dimensions: { ...valid.dimensions } };
    delete (missingDimension.dimensions as Partial<typeof valid.dimensions>).conflict;
    expect(validateThemeFactReviewOutput(missingDimension, [], new Map())).toBeNull();
    const wrongHash = output();
    wrongHash.dimensions.entailment.passageRefs[0].passageContentHash = 'b'.repeat(64);
    expect(
      validateThemeFactReviewOutput(wrongHash, [], new Map([[passageId, passageHash]]))
    ).toBeNull();
  });

  it('limits no_aliases to an empty alias set and aggregates conservatively', () => {
    const valid = output();
    expect(
      validateThemeFactReviewOutput(valid, [], new Map([[passageId, passageHash]]))
    ).not.toBeNull();
    expect(
      validateThemeFactReviewOutput(valid, ['one'], new Map([[passageId, passageHash]]))
    ).toBeNull();
    expect(aggregateThemeFactReviewVerdict(valid.dimensions)).toBe('pass');
    valid.dimensions.scope.verdict = 'flag';
    expect(aggregateThemeFactReviewVerdict(valid.dimensions)).toBe('flag');
    valid.dimensions.conflict.verdict = 'fail';
    expect(aggregateThemeFactReviewVerdict(valid.dimensions)).toBe('fail');
  });

  it('rejects reason codes incompatible with verdicts and ungrounded dimensions', () => {
    const incompatible = output();
    incompatible.dimensions.entailment.reasons = ['unsupported'];
    expect(
      validateThemeFactReviewOutput(incompatible, [], new Map([[passageId, passageHash]]))
    ).toBeNull();
    const ungrounded = output();
    ungrounded.dimensions.scope.passageRefs = [];
    expect(
      validateThemeFactReviewOutput(ungrounded, [], new Map([[passageId, passageHash]]))
    ).toBeNull();
  });
});
