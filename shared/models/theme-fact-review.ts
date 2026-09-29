import { z } from 'zod';
import { sourceClassSchema } from './theme-evidence';

export const THEME_FACT_REVIEW_CONTRACT_VERSION = 'theme-fact-review-v1' as const;
export const THEME_FACT_REVIEW_DIMENSIONS = [
  'entailment',
  'scope',
  'canonical_answer',
  'aliases',
  'conflict',
  'source_independence',
] as const;
export type ThemeFactReviewDimension = (typeof THEME_FACT_REVIEW_DIMENSIONS)[number];
export type ThemeFactReviewVerdict = 'pass' | 'flag' | 'fail';

const reasonVerdicts = {
  entailment: { supported: 'pass', unsupported: 'fail', ambiguous: 'flag' },
  scope: { scope_match: 'pass', scope_mismatch: 'fail', scope_ambiguous: 'flag' },
  canonical_answer: {
    answer_supported: 'pass',
    answer_mismatch: 'fail',
    answer_ambiguous: 'flag',
  },
  aliases: {
    aliases_supported: 'pass',
    alias_unsupported: 'fail',
    alias_ambiguous: 'flag',
    no_aliases: 'pass',
  },
  conflict: {
    no_conflict: 'pass',
    conflicting_evidence: 'fail',
    conflict_unresolved: 'flag',
  },
  source_independence: {
    independent_origins: 'pass',
    shared_origin: 'fail',
    independence_unclear: 'flag',
  },
} as const satisfies Record<ThemeFactReviewDimension, Record<string, ThemeFactReviewVerdict>>;

const reasonCodes = {
  entailment: ['supported', 'unsupported', 'ambiguous'],
  scope: ['scope_match', 'scope_mismatch', 'scope_ambiguous'],
  canonical_answer: ['answer_supported', 'answer_mismatch', 'answer_ambiguous'],
  aliases: ['aliases_supported', 'alias_unsupported', 'alias_ambiguous', 'no_aliases'],
  conflict: ['no_conflict', 'conflicting_evidence', 'conflict_unresolved'],
  source_independence: ['independent_origins', 'shared_origin', 'independence_unclear'],
} as const satisfies Record<ThemeFactReviewDimension, readonly [string, ...string[]]>;

export const themeFactReviewPolicySchema = z
  .object({
    sourcePolicyVersion: z.string().trim().min(1).max(255),
    extractorVersion: z.string().trim().min(1).max(255),
    allowedSourceClasses: z.array(sourceClassSchema).min(1).max(4),
    minimumOriginGroups: z.number().int().min(1).max(12),
    maxSourceAgeMs: z
      .number()
      .int()
      .positive()
      .max(10 * 365 * 24 * 60 * 60 * 1000),
    validForMs: z
      .number()
      .int()
      .positive()
      .max(10 * 365 * 24 * 60 * 60 * 1000),
  })
  .strict();
export type ThemeFactReviewPolicy = z.infer<typeof themeFactReviewPolicySchema>;

const passageRefSchema = z
  .object({
    passageId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    passageContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const dimensionSchema = <K extends ThemeFactReviewDimension>(dimension: K) =>
  z
    .object({
      verdict: z.enum(['pass', 'flag', 'fail']),
      reasons: z.array(z.enum(reasonCodes[dimension])).min(1).max(4),
      passageRefs: z.array(passageRefSchema).max(12),
    })
    .strict()
    .superRefine((value, ctx) => {
      const compatibility = reasonVerdicts[dimension] as Record<string, ThemeFactReviewVerdict>;
      const allowedVerdicts = value.reasons.map((reason) => compatibility[reason]);
      if (allowedVerdicts.some((verdict) => verdict !== value.verdict))
        ctx.addIssue({ code: 'custom', message: 'reason codes must match the verdict' });
      if (
        value.passageRefs.length === 0 &&
        !(
          dimension === 'aliases' &&
          value.verdict === 'pass' &&
          value.reasons.length === 1 &&
          value.reasons[0] === 'no_aliases'
        )
      )
        ctx.addIssue({ code: 'custom', message: 'a review dimension requires passage references' });
      const keys = value.passageRefs.map((ref) => ref.passageId);
      if (new Set(keys).size !== keys.length)
        ctx.addIssue({ code: 'custom', message: 'passage references must be unique' });
    });

export const themeFactReviewDimensionsSchema = z
  .object({
    entailment: dimensionSchema('entailment'),
    scope: dimensionSchema('scope'),
    canonical_answer: dimensionSchema('canonical_answer'),
    aliases: dimensionSchema('aliases'),
    conflict: dimensionSchema('conflict'),
    source_independence: dimensionSchema('source_independence'),
  })
  .strict();

export const themeFactReviewInputSchema = z
  .object({
    contractVersion: z.literal(THEME_FACT_REVIEW_CONTRACT_VERSION),
    statement: z.string().min(1).max(4000),
    scope: z.record(z.string(), z.unknown()),
    canonicalAnswer: z.string().min(1).max(1000),
    supportedAliases: z.array(z.string().min(1).max(1000)).max(50),
    evidence: z
      .array(
        z
          .object({
            passageId: z.string().uuid(),
            passageContentHash: z.string().regex(/^[a-f0-9]{64}$/),
            text: z.string().min(1).max(32_000),
            originGroup: z.string().min(1).max(255),
            supportKind: z.enum(['supports', 'conflicts', 'context', 'uncited']),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();

export const themeFactReviewOutputSchema = z
  .object({
    dimensions: themeFactReviewDimensionsSchema,
  })
  .strict();

export type ThemeFactReviewInput = z.infer<typeof themeFactReviewInputSchema>;
export type ThemeFactReviewOutput = z.infer<typeof themeFactReviewOutputSchema>;

export function aggregateThemeFactReviewVerdict(
  dimensions: ThemeFactReviewOutput['dimensions']
): ThemeFactReviewVerdict {
  const verdicts = Object.values(dimensions).map(({ verdict }) => verdict);
  if (verdicts.includes('fail')) return 'fail';
  if (verdicts.includes('flag')) return 'flag';
  return 'pass';
}

export function validateThemeFactReviewOutput(
  raw: unknown,
  aliases: readonly string[],
  allowedPassageHashes: ReadonlyMap<string, string>
): ThemeFactReviewOutput | null {
  const parsed = themeFactReviewOutputSchema.safeParse(raw);
  if (!parsed.success) return null;
  for (const dimension of Object.values(parsed.data.dimensions)) {
    for (const ref of dimension.passageRefs)
      if (allowedPassageHashes.get(ref.passageId) !== ref.passageContentHash) return null;
  }
  const aliasReasons = parsed.data.dimensions.aliases.reasons;
  if (aliases.length === 0) {
    if (aliasReasons.length !== 1 || aliasReasons[0] !== 'no_aliases') return null;
  } else if (aliasReasons.includes('no_aliases')) return null;
  return parsed.data;
}
