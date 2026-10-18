import { z } from 'zod';

import { sourceClassSchema } from './theme-evidence';

export const THEME_CLAIM_EVIDENCE_POLICY_CONTRACT_VERSION =
  'theme-claim-evidence-policy-v1' as const;

const identifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/);

const evidenceRequirementSchema = z
  .object({
    allowedSourceClasses: z.array(sourceClassSchema).min(1).max(4),
    atLeastOneFromSourceClasses: z.array(sourceClassSchema).max(4),
    minimumIndependentOriginGroups: z.number().int().min(1).max(4),
  })
  .strict()
  .superRefine((requirement, context) => {
    if (new Set(requirement.allowedSourceClasses).size !== requirement.allowedSourceClasses.length)
      context.addIssue({
        code: 'custom',
        path: ['allowedSourceClasses'],
        message: 'Source classes must be unique',
      });
    if (
      new Set(requirement.atLeastOneFromSourceClasses).size !==
      requirement.atLeastOneFromSourceClasses.length
    )
      context.addIssue({
        code: 'custom',
        path: ['atLeastOneFromSourceClasses'],
        message: 'Required source classes must be unique',
      });
    if (
      requirement.atLeastOneFromSourceClasses.some(
        (sourceClass) => !requirement.allowedSourceClasses.includes(sourceClass)
      )
    )
      context.addIssue({
        code: 'custom',
        path: ['atLeastOneFromSourceClasses'],
        message: 'Required source classes must also be allowed',
      });
  });

export const themeClaimEvidencePolicySchema = z
  .object({
    contractVersion: z.literal(THEME_CLAIM_EVIDENCE_POLICY_CONTRACT_VERSION),
    policyVersion: identifierSchema,
    stable: evidenceRequirementSchema,
    timeSensitive: evidenceRequirementSchema,
    superlative: evidenceRequirementSchema,
    disputed: evidenceRequirementSchema,
  })
  .strict()
  .superRefine((policy, context) => {
    for (const risk of ['timeSensitive', 'superlative', 'disputed'] as const) {
      const requirement = policy[risk];
      if (
        requirement.minimumIndependentOriginGroups < 2 ||
        requirement.atLeastOneFromSourceClasses.length === 0 ||
        !requirement.atLeastOneFromSourceClasses.every((sourceClass) =>
          ['primary_official', 'primary_record', 'secondary_authoritative'].includes(sourceClass)
        )
      )
        context.addIssue({
          code: 'custom',
          path: [risk],
          message: 'Higher-risk claims require independent authoritative corroboration',
        });
    }
  });

export type ThemeClaimEvidencePolicy = z.infer<typeof themeClaimEvidencePolicySchema>;
