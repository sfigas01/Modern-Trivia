import { describe, expect, it, vi } from 'vitest';

import {
  createThemeE1Providers,
  THEME_E1_POLICY_SNAPSHOT,
  THEME_E1_PRICING,
} from './theme-e1-provider-bundle';
import type { ThemeOpenAITransports } from './theme-openai-preview-runtime';

function transports(
  output: unknown = {
    result: { status: 'insufficient_evidence' },
  }
) {
  const responses = vi.fn(async (request) => ({
    id: 'response-1',
    model: request.model,
    status: 'completed' as const,
    output_text: JSON.stringify(output),
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0 },
      output_tokens: 20,
    },
  }));
  const embeddings = vi.fn();
  return {
    value: {
      responses: { create: responses },
      embeddings: { create: embeddings },
    } as unknown as ThemeOpenAITransports,
    responses,
    embeddings,
  };
}

describe('E1 OpenAI provider bundle', () => {
  it('freezes the approved models, reasoning, ceilings and conservative Standard prices', () => {
    expect(THEME_E1_POLICY_SNAPSHOT.bundleVersion).toBe('theme-e1-openai-2026-11-21-v4');
    expect(THEME_E1_PRICING).toMatchObject({
      version: 'openai-standard-2026-11-08-v1',
      models: {
        'gpt-6-luna': {
          inputMicrosPerMillionTokens: 125_000,
          outputMicrosPerMillionTokens: 500_000,
        },
        'gpt-6.1-sol': {
          inputMicrosPerMillionTokens: 2_500_000,
          outputMicrosPerMillionTokens: 10_000_000,
        },
      },
    });
    expect(THEME_E1_POLICY_SNAPSHOT.policies).toMatchObject({
      proposer: { model: 'gpt-6-luna', reasoningEffort: 'low', maxRetries: 0 },
      factReview: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxRetries: 0 },
      writer: { model: 'gpt-6-luna', reasoningEffort: 'low', maxRetries: 0 },
      evidenceReview: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxRetries: 0 },
      repair: { model: 'gpt-6-luna', reasoningEffort: 'low', maxRetries: 0 },
      quality: { model: 'gpt-6.1-sol', reasoningEffort: 'medium', maxRetries: 0 },
      semantic: { model: 'gpt-6.1-sol', reasoningEffort: 'low', maxRetries: 0 },
    });
  });

  it('constructs every provider without touching either transport', () => {
    const fixture = transports();
    const providers = createThemeE1Providers(fixture.value);

    expect(fixture.responses).not.toHaveBeenCalled();
    expect(fixture.embeddings).not.toHaveBeenCalled();
    expect(providers.proposer.reservedCostMicros).toBe(1_250);
    expect(providers.factReviewer.reservedCostMicros).toBe(27_000);
    expect(providers.writer.reservedCostMicros).toBe(900);
    expect(providers.evidenceReviewer.reservedCostMicros).toBe(27_000);
    expect(providers.quality.reservedCostMicros).toBe(18_000);
    expect(providers.semantic.reservedCostMicros).toBe(7_750);
    expect(providers.embeddings.reservedCostMicros).toBe(200);
  });

  it('sends a strict structured response only when explicitly invoked', async () => {
    const fixture = transports();
    const providers = createThemeE1Providers(fixture.value);
    const result = await providers.proposer.invoke([
      {
        passageId: '11111111-1111-4111-8111-111111111111',
        text: 'The supplied passage is insufficient.',
        contentHash: 'a'.repeat(64),
      },
    ]);

    expect(result.value).toEqual({ status: 'insufficient_evidence' });
    expect(fixture.responses).toHaveBeenCalledOnce();
    expect(fixture.responses.mock.calls[0][0]).toMatchObject({
      model: 'gpt-6-luna',
      service_tier: 'default',
      reasoning: { effort: 'low' },
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          name: 'theme_e1_proposer',
          schema: {
            type: 'object',
            additionalProperties: false,
            required: ['result'],
            properties: { result: { anyOf: expect.any(Array) } },
          },
        },
      },
    });
    expect(JSON.stringify(fixture.responses.mock.calls[0][0].text.format.schema)).not.toContain(
      '"oneOf"'
    );
  });

  it('accepts a proposed fact through the same discriminated branch sent to OpenAI', async () => {
    const fixture = transports({
      result: {
        status: 'proposed',
        statement: 'Mount Etna is on the island of Sicily.',
        scope: {
          entity: 'Mount Etna',
          relation: 'location',
          time: null,
          geography: 'Sicily, Italy',
          competitionOrDomain: 'volcanology',
          qualifiers: [],
          asOf: null,
        },
        canonicalAnswer: 'Sicily',
        supportedAliases: [],
        timeSensitive: false,
        citations: [
          {
            passageId: '11111111-1111-4111-8111-111111111111',
            passageContentHash: 'a'.repeat(64),
            supportKind: 'supports',
          },
        ],
      },
    });

    const result = await createThemeE1Providers(fixture.value).proposer.invoke([
      {
        passageId: '11111111-1111-4111-8111-111111111111',
        text: 'Mount Etna is on the island of Sicily.',
        contentHash: 'a'.repeat(64),
      },
    ]);

    expect(result).toMatchObject({
      value: { status: 'proposed', canonicalAnswer: 'Sicily' },
      outcome: { status: 'succeeded' },
    });
  });

  it('requires proposal slots to generate the fact and finished Q&A together', async () => {
    const proposed = {
      status: 'proposed',
      statement: 'Mount Etna is on the island of Sicily.',
      scope: {
        entity: 'Mount Etna',
        relation: 'location',
        time: null,
        geography: 'Sicily, Italy',
        competitionOrDomain: 'volcanology',
        qualifiers: [],
        asOf: null,
      },
      canonicalAnswer: 'Sicily',
      supportedAliases: [],
      timeSensitive: false,
      citations: [
        {
          passageId: '11111111-1111-4111-8111-111111111111',
          passageContentHash: 'a'.repeat(64),
          supportKind: 'supports',
        },
      ],
    };
    const missingPackage = transports({ result: proposed });
    await expect(
      createThemeE1Providers(missingPackage.value).slotProposer.invoke({} as never)
    ).resolves.toMatchObject({
      outcome: { status: 'failed', failureCode: 'invalid_output_contract_mismatch' },
    });
    expect(JSON.stringify(missingPackage.responses.mock.calls[0][0].text.format.schema)).toMatch(
      /"required":\[[^\]]*"questionPackage"/
    );

    const complete = transports({
      result: {
        ...proposed,
        questionPackage: {
          status: 'candidate',
          question: 'Which Italian island is home to Mount Etna?',
          answer: 'Sicily',
          acceptedAlternatives: [],
          hint: 'It is the largest island in the Mediterranean Sea.',
          difficulty: 'Easy',
          predictedCorrectRate: 82,
          explanation: 'Mount Etna is on Sicily, an island of Italy.',
        },
      },
    });
    await expect(
      createThemeE1Providers(complete.value).slotProposer.invoke({} as never)
    ).resolves.toMatchObject({
      value: {
        status: 'proposed',
        questionPackage: { answer: 'Sicily', difficulty: 'Easy' },
      },
      outcome: { status: 'succeeded' },
    });
  });

  it('rejects the superseded flat nullable response instead of interpreting it', async () => {
    const fixture = transports({
      status: 'insufficient_evidence',
      statement: null,
      scope: null,
      canonicalAnswer: null,
      supportedAliases: null,
      timeSensitive: null,
      citations: null,
    });

    const result = await createThemeE1Providers(fixture.value).proposer.invoke([]);

    expect(result).toMatchObject({
      outcome: {
        status: 'failed',
        failureCode: 'invalid_output_contract_mismatch',
      },
    });
    expect(result.value).toBeUndefined();
  });

  it('gives writer and repair the same branch-exact root envelope', async () => {
    const fixture = transports({
      result: {
        status: 'declined',
        reason: 'answer_not_unique',
        explanation: 'More than one answer would be reasonable.',
      },
    });
    const providers = createThemeE1Providers(fixture.value);

    await expect(providers.writer.invoke({} as never)).resolves.toMatchObject({
      value: { status: 'declined', reason: 'answer_not_unique' },
      outcome: { status: 'succeeded' },
    });
    await expect(providers.repairer.invoke({} as never)).resolves.toMatchObject({
      value: { status: 'declined', reason: 'answer_not_unique' },
      outcome: { status: 'succeeded' },
    });

    for (const request of fixture.responses.mock.calls.map(([request]) => request)) {
      expect(request.text.format.schema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['result'],
        properties: { result: { anyOf: expect.any(Array) } },
      });
      expect(JSON.stringify(request.text.format.schema)).not.toContain('"oneOf"');
    }
  });
});
