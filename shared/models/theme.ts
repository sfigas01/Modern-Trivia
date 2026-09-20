import { z } from 'zod';

import { VALID_CATEGORIES } from '../constants/categories';
import { THEME_RELIABILITY_CONTRACT_VERSION } from './theme-evidence';

export const THEME_PLAYER_COUNTS = [2, 3, 4] as const;
export const THEME_QUESTION_TOTALS = [40, 60, 80] as const;
export const THEME_CANDIDATE_CEILINGS = [50, 75, 100] as const;
export const THEME_OPENING_BUFFER_TOTALS = [16, 24, 32] as const;

export const THEME_GAME_LIMITS = {
  2: {
    questions: 40,
    themedQuestions: 30,
    relatedQuestions: 10,
    candidateCeiling: 50,
    openingQuestions: 16,
    openingThemedQuestions: 12,
    openingRelatedQuestions: 4,
  },
  3: {
    questions: 60,
    themedQuestions: 45,
    relatedQuestions: 15,
    candidateCeiling: 75,
    openingQuestions: 24,
    openingThemedQuestions: 18,
    openingRelatedQuestions: 6,
  },
  4: {
    questions: 80,
    themedQuestions: 60,
    relatedQuestions: 20,
    candidateCeiling: 100,
    openingQuestions: 32,
    openingThemedQuestions: 24,
    openingRelatedQuestions: 8,
  },
} as const;

export const THEME_JOB_STATUSES = [
  'queued',
  'researching',
  'retrieving',
  'extracting',
  'writing',
  'reviewing',
  'qa',
  'semantic_check',
  'reserving',
  'ready',
  'shortfall',
  'waiting',
  'completed',
  'failed',
  'canceled',
  'expired',
] as const;
export const themeJobStatusSchema = z.enum(THEME_JOB_STATUSES);

export const THEME_PUBLIC_STAGES = [
  'waiting',
  'researching',
  'generating',
  'verifying',
  'reserving',
  'ready',
  'paused',
  'failed',
] as const;
export const themePublicStageSchema = z.enum(THEME_PUBLIC_STAGES);

export const THEME_INTERNAL_FAILURE_CODES = [
  'invalid_theme',
  'unsupported_theme',
  'source_unavailable',
  'unsafe_source',
  'source_stale',
  'evidence_insufficient',
  'evidence_conflict',
  'claim_ambiguous',
  'answer_not_unique',
  'alias_unsupported',
  'explanation_unsupported',
  'qa_incomplete',
  'semantic_duplicate',
  'candidate_limit_exhausted',
  'budget_unavailable',
  'provider_timeout',
  'provider_rejected',
  'provider_unknown_outcome',
  'reservation_conflict',
  'history_conflict',
  'inventory_shortfall',
  'job_canceled',
  'internal_error',
] as const;
export const themeInternalFailureCodeSchema = z.enum(THEME_INTERNAL_FAILURE_CODES);

export const THEME_PUBLIC_FAILURE_CODES = [
  'theme_not_supported',
  'not_enough_verified_questions',
  'related_inventory_shortfall',
  'daily_capacity_unavailable',
  'preparation_paused',
  'preparation_failed',
] as const;
export const themePublicFailureCodeSchema = z.enum(THEME_PUBLIC_FAILURE_CODES);

export const THEME_ATTEMPT_OPERATIONS = [
  'research',
  'retrieve',
  'extract_fact',
  'generate',
  'review',
  'repair',
  'embed',
  'semantic_check',
] as const;
export const themeAttemptOperationSchema = z.enum(THEME_ATTEMPT_OPERATIONS);

export const THEME_ATTEMPT_STATUSES = [
  'reserved',
  'dispatched',
  'succeeded',
  'failed',
  'unknown',
  'canceled',
] as const;
export const themeAttemptStatusSchema = z.enum(THEME_ATTEMPT_STATUSES);

export const THEME_CANDIDATE_STATUSES = [
  'pending',
  'reviewing',
  'accepted',
  'rejected',
  'duplicate',
  'superseded',
] as const;
export const themeCandidateStatusSchema = z.enum(THEME_CANDIDATE_STATUSES);

export const THEME_GAME_MODES = ['multiplayer', 'shared_device'] as const;
export const themeGameModeSchema = z.enum(THEME_GAME_MODES);

export const THEME_GAME_STATUSES = [
  'setup',
  'preflight',
  'preparing',
  'awaiting_mix_consent',
  'ready',
  'active',
  'paused',
  'waiting',
  'completed',
  'failed',
  'abandoned',
  'expired',
] as const;
export const themeGameStatusSchema = z.enum(THEME_GAME_STATUSES);

export const THEME_MIX_CONSENT_STATUSES = [
  'not_required',
  'pending',
  'accepted',
  'declined',
] as const;
export const themeMixConsentStatusSchema = z.enum(THEME_MIX_CONSENT_STATUSES);

export const THEME_IDENTITY_KINDS = ['account', 'guest_browser', 'shared_device'] as const;
export const themeIdentityKindSchema = z.enum(THEME_IDENTITY_KINDS);

export const THEME_RESERVATION_ROLES = ['theme', 'related_backup'] as const;
export const themeReservationRoleSchema = z.enum(THEME_RESERVATION_ROLES);

export const THEME_RESERVATION_STATUSES = [
  'held',
  'selected',
  'displayed',
  'released',
  'expired',
] as const;
export const themeReservationStatusSchema = z.enum(THEME_RESERVATION_STATUSES);

export const THEME_BUDGET_ALLOCATION_STATUSES = [
  'reserved',
  'partially_settled',
  'settled',
  'released',
  'expired',
] as const;
export const themeBudgetAllocationStatusSchema = z.enum(THEME_BUDGET_ALLOCATION_STATUSES);

const themeTextSchema = z.string().trim().min(2).max(60);
const themeSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(100);
const categorySchema = z.enum(VALID_CATEGORIES);

export const themeGamePlanSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    playerCount: z.union([z.literal(2), z.literal(3), z.literal(4)]),
    questionCount: z.number().int(),
    themedQuestionTarget: z.number().int(),
    relatedQuestionTarget: z.number().int(),
    candidateCeiling: z.number().int(),
    openingQuestionTarget: z.number().int(),
    openingThemedTarget: z.number().int(),
    openingRelatedTarget: z.number().int(),
  })
  .strict()
  .superRefine((plan, context) => {
    const expected = THEME_GAME_LIMITS[plan.playerCount];
    const fields = [
      ['questionCount', expected.questions],
      ['themedQuestionTarget', expected.themedQuestions],
      ['relatedQuestionTarget', expected.relatedQuestions],
      ['candidateCeiling', expected.candidateCeiling],
      ['openingQuestionTarget', expected.openingQuestions],
      ['openingThemedTarget', expected.openingThemedQuestions],
      ['openingRelatedTarget', expected.openingRelatedQuestions],
    ] as const;
    for (const [field, value] of fields) {
      if (plan[field] !== value) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: `${field} must be ${value} for ${plan.playerCount} players`,
        });
      }
    }
  });

export function themeGamePlanFor(playerCount: (typeof THEME_PLAYER_COUNTS)[number]) {
  const limits = THEME_GAME_LIMITS[playerCount];
  return themeGamePlanSchema.parse({
    contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
    playerCount,
    questionCount: limits.questions,
    themedQuestionTarget: limits.themedQuestions,
    relatedQuestionTarget: limits.relatedQuestions,
    candidateCeiling: limits.candidateCeiling,
    openingQuestionTarget: limits.openingQuestions,
    openingThemedTarget: limits.openingThemedQuestions,
    openingRelatedTarget: limits.openingRelatedQuestions,
  });
}

export const createThemeGameRequestSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    idempotencyKey: z.string().trim().min(16).max(255),
    mode: themeGameModeSchema,
    theme: themeTextSchema,
    themeSlug: themeSlugSchema,
    relatedCategories: z.array(categorySchema).min(1).max(6),
    playerCount: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.relatedCategories).size !== request.relatedCategories.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relatedCategories'],
        message: 'related categories must be unique',
      });
    }
  });

export const internalThemeFailureSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    code: themeInternalFailureCodeSchema,
    retryable: z.boolean(),
    operation: themeAttemptOperationSchema.nullable(),
    provider: z.string().trim().min(1).max(255).nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    candidateOrdinal: z.number().int().positive().max(100).nullable(),
  })
  .strict();

export const publicThemeFailureSchema = z
  .object({
    code: themePublicFailureCodeSchema,
    retryable: z.boolean(),
    message: z.string().trim().min(1).max(500),
  })
  .strict();

export const publicThemeProgressSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    gameId: z.string().uuid(),
    jobId: z.string().uuid(),
    status: themeJobStatusSchema,
    stage: themePublicStageSchema,
    readyCount: z.number().int().nonnegative().max(80),
    requiredCount: z.number().int().positive().max(80),
    openingReadyCount: z.number().int().nonnegative().max(32),
    openingRequiredCount: z.number().int().positive().max(32),
    themedReadyCount: z.number().int().nonnegative().max(60),
    relatedReadyCount: z.number().int().nonnegative().max(20),
    candidatesUsed: z.number().int().nonnegative().max(100),
    candidateCeiling: z.number().int().positive().max(100),
    canStart: z.boolean(),
    needsHostDecision: z.boolean(),
    failure: publicThemeFailureSchema.nullable(),
    updatedAt: z.string().datetime(),
  })
  .strict()
  .superRefine((progress, context) => {
    const invalidCounts =
      progress.readyCount > progress.requiredCount ||
      progress.openingReadyCount > progress.openingRequiredCount ||
      progress.candidatesUsed > progress.candidateCeiling;
    if (invalidCounts) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['readyCount'],
        message: 'progress counts cannot exceed their declared limits',
      });
    }
  });

export const publicThemeJobSchema = z
  .object({
    contractVersion: z.literal(THEME_RELIABILITY_CONTRACT_VERSION),
    gameId: z.string().uuid(),
    jobId: z.string().uuid(),
    theme: themeTextSchema,
    relatedCategories: z.array(categorySchema).min(1).max(6),
    progress: publicThemeProgressSchema,
  })
  .strict();

export type ThemeGamePlan = z.infer<typeof themeGamePlanSchema>;
export type CreateThemeGameRequest = z.infer<typeof createThemeGameRequestSchema>;
export type InternalThemeFailure = z.infer<typeof internalThemeFailureSchema>;
export type PublicThemeFailure = z.infer<typeof publicThemeFailureSchema>;
export type PublicThemeProgress = z.infer<typeof publicThemeProgressSchema>;
export type PublicThemeJob = z.infer<typeof publicThemeJobSchema>;
