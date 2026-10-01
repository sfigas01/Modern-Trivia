import { z } from 'zod';

import { sourceClassSchema, type QuestionContentSnapshot } from './theme-evidence';

export const THEME_QUESTION_GENERATION_CONTRACT_VERSION = 'theme-question-generation-v1' as const;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const identifierSchema = z.string().trim().min(1).max(255);

export const themeQuestionGenerationPolicySchema = z
  .object({
    generationPolicyVersion: identifierSchema,
    sourcePolicyVersion: identifierSchema,
    extractorVersion: identifierSchema,
    allowedSourceClasses: z.array(sourceClassSchema).min(1).max(4),
    maxSourceAgeMs: z
      .number()
      .int()
      .positive()
      .max(10 * 365 * 24 * 60 * 60 * 1000),
    minimumOriginGroups: z.number().int().min(1).max(12),
    category: z.string().trim().min(1).max(255),
    difficulty: z.enum(['Easy', 'Medium', 'Hard']),
    pillar: z.string().trim().min(1).max(100),
    tags: z.array(z.string().trim().min(1).max(255)).max(100),
  })
  .strict();
export type ThemeQuestionGenerationPolicy = z.infer<typeof themeQuestionGenerationPolicySchema>;

export const themeQuestionGenerationRequestSchema = z
  .object({
    attemptId: uuidSchema,
    jobId: uuidSchema,
    ordinal: z.number().int().min(1).max(100),
    candidateId: uuidSchema,
    questionRevisionId: uuidSchema,
    factId: uuidSchema,
    factRevisionId: uuidSchema,
    factContentHash: hashSchema,
    factReviewAttemptId: uuidSchema,
    factReviewOutputHash: hashSchema,
    repairOf: z
      .object({
        parentCandidateId: uuidSchema,
        parentQuestionRevisionId: uuidSchema,
        parentQuestionContentHash: hashSchema,
        evidenceReviewAttemptId: uuidSchema,
        failureStage: z.enum(['static', 'quality']),
        failureReason: z.enum(['static_finding', 'quality_adverse']),
      })
      .strict()
      .refine(
        (value) =>
          (value.failureStage === 'static' && value.failureReason === 'static_finding') ||
          (value.failureStage === 'quality' && value.failureReason === 'quality_adverse')
      )
      .optional(),
  })
  .strict();
export type ThemeQuestionGenerationRequest = z.infer<typeof themeQuestionGenerationRequestSchema>;

export const themeQuestionWriterInputSchema = z
  .object({
    contractVersion: z.literal(THEME_QUESTION_GENERATION_CONTRACT_VERSION),
    fact: z
      .object({
        id: uuidSchema,
        revisionId: uuidSchema,
        contentHash: hashSchema,
        statement: z.string().min(1).max(4_000),
        scope: z.record(z.string(), z.unknown()),
        canonicalAnswer: z.string().min(1).max(1_000),
        supportedAliases: z.array(z.string().min(1).max(1_000)).max(50),
      })
      .strict(),
    evidence: z
      .array(
        z
          .object({
            passageId: uuidSchema,
            passageContentHash: hashSchema,
            text: z.string().min(1).max(32_000),
            originGroup: identifierSchema,
            sourceClass: sourceClassSchema,
            supportKind: z.enum(['supports', 'conflicts', 'context', 'uncited']),
          })
          .strict()
      )
      .min(1)
      .max(12),
  })
  .strict();
export type ThemeQuestionWriterInput = z.infer<typeof themeQuestionWriterInputSchema>;

export const themeQuestionWriterOutputSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('candidate'),
      question: z.string().trim().min(1).max(4_000),
      explanation: z.string().trim().min(1).max(8_000),
    })
    .strict(),
  z.object({ status: z.literal('declined') }).strict(),
]);
export type ThemeQuestionWriterOutput = z.infer<typeof themeQuestionWriterOutputSchema>;
export type QuestionContentSnapshotType = QuestionContentSnapshot;
export type ThemeQuestionGenerationDecision =
  | {
      status: 'persisted';
      attemptId: string;
      candidateId: string;
      questionRevisionId: string;
      contentHash: string;
      content: QuestionContentSnapshot;
    }
  | {
      status: 'declined' | 'invalid_output' | 'ineligible' | 'failed';
      attemptId: string;
      failureCode: string;
    };
