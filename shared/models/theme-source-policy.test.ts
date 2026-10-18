import { describe, expect, it } from 'vitest';

import { themeClaimEvidencePolicySchema } from './theme-source-policy';

const policy = {
  contractVersion: 'theme-claim-evidence-policy-v1',
  policyVersion: 'preview-evidence-v1',
  stable: {
    allowedSourceClasses: ['secondary_reputable'],
    atLeastOneFromSourceClasses: [],
    minimumIndependentOriginGroups: 1,
  },
  timeSensitive: {
    allowedSourceClasses: ['secondary_reputable', 'primary_official', 'secondary_authoritative'],
    atLeastOneFromSourceClasses: ['primary_official', 'secondary_authoritative'],
    minimumIndependentOriginGroups: 2,
  },
  superlative: {
    allowedSourceClasses: ['secondary_reputable', 'primary_record', 'secondary_authoritative'],
    atLeastOneFromSourceClasses: ['primary_record', 'secondary_authoritative'],
    minimumIndependentOriginGroups: 2,
  },
  disputed: {
    allowedSourceClasses: ['secondary_reputable', 'primary_record', 'secondary_authoritative'],
    atLeastOneFromSourceClasses: ['primary_record', 'secondary_authoritative'],
    minimumIndependentOriginGroups: 2,
  },
} as const;

describe('theme claim evidence policy contract', () => {
  it('allows Wikipedia-class evidence for stable claims and requires corroboration for risk', () => {
    expect(themeClaimEvidencePolicySchema.safeParse(policy).success).toBe(true);
  });

  it.each(['timeSensitive', 'superlative', 'disputed'] as const)(
    'rejects a Wikipedia-only %s rule',
    (risk) => {
      expect(
        themeClaimEvidencePolicySchema.safeParse({
          ...policy,
          [risk]: {
            allowedSourceClasses: ['secondary_reputable'],
            atLeastOneFromSourceClasses: [],
            minimumIndependentOriginGroups: 1,
          },
        }).success
      ).toBe(false);
    }
  );

  it('rejects duplicate source classes and unknown fields', () => {
    expect(
      themeClaimEvidencePolicySchema.safeParse({
        ...policy,
        stable: {
          allowedSourceClasses: ['secondary_reputable', 'secondary_reputable'],
          atLeastOneFromSourceClasses: [],
          minimumIndependentOriginGroups: 1,
        },
      }).success
    ).toBe(false);
    expect(themeClaimEvidencePolicySchema.safeParse({ ...policy, extra: true }).success).toBe(
      false
    );
  });

  it('rejects required classes that are not allowed or are not authoritative', () => {
    expect(
      themeClaimEvidencePolicySchema.safeParse({
        ...policy,
        timeSensitive: {
          ...policy.timeSensitive,
          allowedSourceClasses: ['secondary_reputable', 'primary_official'],
          atLeastOneFromSourceClasses: ['secondary_reputable', 'primary_official'],
        },
      }).success
    ).toBe(false);
    expect(
      themeClaimEvidencePolicySchema.safeParse({
        ...policy,
        timeSensitive: {
          ...policy.timeSensitive,
          atLeastOneFromSourceClasses: ['primary_record'],
        },
      }).success
    ).toBe(false);
  });
});
