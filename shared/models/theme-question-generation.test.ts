import { describe, expect, it } from 'vitest';

import {
  themeQuestionGenerationPolicySchema,
  themeQuestionGenerationRequestSchema,
  themeQuestionWriterInputSchema,
  themeQuestionWriterOutputSchema,
} from './theme-question-generation';

const request = {
  attemptId: '17e668ec-56f5-4cee-85d2-93b31f03c0ab',
  jobId: 'dd5a4454-55fa-4b4e-931b-3e554b776184',
  ordinal: 1,
  candidateId: 'aac49e32-d9d8-4834-8393-e942f89891ae',
  questionRevisionId: '8a311435-dd3f-4302-a2b8-d3e501192fbb',
  factId: '6899b1b5-e08e-49b7-9aca-4744e27b66ed',
  factRevisionId: 'dc363339-8ed5-456d-9b42-841b50c24528',
  factContentHash: 'a'.repeat(64),
  factReviewAttemptId: '52ddf64e-1dd2-43ab-8122-4360f9a2d687',
  factReviewOutputHash: 'b'.repeat(64),
};

describe('theme question generation contract', () => {
  it('requires exact IDs and bounded ordinals and hashes', () => {
    expect(themeQuestionGenerationRequestSchema.safeParse(request).success).toBe(true);
    expect(
      themeQuestionGenerationRequestSchema.safeParse({ ...request, ordinal: 101 }).success
    ).toBe(false);
    expect(
      themeQuestionGenerationRequestSchema.safeParse({ ...request, factContentHash: 'not-a-hash' })
        .success
    ).toBe(false);
    expect(
      themeQuestionGenerationRequestSchema.safeParse({ ...request, extra: true }).success
    ).toBe(false);
  });

  it('validates the trusted source policy and enforces an exact writer output union', () => {
    const policy = {
      generationPolicyVersion: 'question-writer-v1',
      sourcePolicyVersion: 'source-v1',
      extractorVersion: 'extractor-v1',
      allowedSourceClasses: ['primary_record'],
      maxSourceAgeMs: 60_000,
      minimumOriginGroups: 1,
      category: 'History & Geography',
      difficulty: 'Medium',
      pillar: 'Recall',
      tags: ['history'],
    };
    expect(themeQuestionGenerationPolicySchema.safeParse(policy).success).toBe(true);
    expect(
      themeQuestionGenerationPolicySchema.safeParse({ ...policy, callerApproved: true }).success
    ).toBe(false);
    expect(themeQuestionWriterOutputSchema.safeParse({ status: 'declined' }).success).toBe(true);
    expect(
      themeQuestionWriterOutputSchema.safeParse({
        status: 'candidate',
        question: 'Which year?',
        explanation: 'The supported record states the year.',
      }).success
    ).toBe(true);
    expect(
      themeQuestionWriterOutputSchema.safeParse({
        status: 'candidate',
        question: 'Which year?',
        explanation: 'Explanation',
        answer: '1901',
      }).success
    ).toBe(false);
  });

  it('rejects malformed or oversized writer evidence input', () => {
    const input = {
      contractVersion: 'theme-question-generation-v1',
      fact: {
        id: request.factId,
        revisionId: request.factRevisionId,
        contentHash: request.factContentHash,
        statement: 'A fictional event occurred in 1901.',
        scope: { entity: 'event', relation: 'year' },
        canonicalAnswer: '1901',
        supportedAliases: [],
      },
      evidence: [
        {
          passageId: request.factReviewAttemptId,
          passageContentHash: 'c'.repeat(64),
          text: 'The event occurred in 1901.',
          originGroup: 'archive',
          sourceClass: 'primary_record',
          supportKind: 'supports',
        },
      ],
    };
    expect(themeQuestionWriterInputSchema.safeParse(input).success).toBe(true);
    expect(themeQuestionWriterInputSchema.safeParse({ ...input, evidence: [] }).success).toBe(
      false
    );
    expect(
      themeQuestionWriterInputSchema.safeParse({ ...input, injectedField: 'untrusted' }).success
    ).toBe(false);
  });
});
