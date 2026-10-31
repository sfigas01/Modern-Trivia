import { describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';

import {
  ThemeProviderPersistenceConflictError,
  persistThemeSemanticBatch,
  recordThemeProviderMetadata,
} from './theme-provider-persistence';

function queryClient(handler: (text: string, values?: unknown[]) => unknown) {
  const query = vi.fn(
    async (text: string, values?: unknown[]) => (handler(text, values) ?? { rows: [] }) as never
  );
  return { query } as unknown as Pick<PoolClient, 'query'>;
}

const hash = 'a'.repeat(64);

describe('theme provider metadata persistence', () => {
  it('uses the supplied client and treats an exact attempt replay as idempotent', async () => {
    const client = queryClient((text) => {
      if (text.includes('SELECT provider_request_id'))
        return {
          rows: [{ provider_request_id: 'req-1', returned_model: 'model-1', latency_ms: 37 }],
        };
      return { rows: [] };
    });

    await recordThemeProviderMetadata(client, 'attempt-1', {
      providerRequestId: 'req-1',
      returnedModel: 'model-1',
      latencyMs: 37,
    });

    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO theme_job_attempt_provider_metadata'),
      ['attempt-1', 'req-1', 'model-1', 37]
    );
  });

  it('fails when an attempt replay changes metadata and rejects negative latency', async () => {
    const client = queryClient((text) =>
      text.includes('SELECT provider_request_id')
        ? { rows: [{ provider_request_id: 'req-old', returned_model: 'model-1', latency_ms: 37 }] }
        : { rows: [] }
    );
    await expect(
      recordThemeProviderMetadata(client, 'attempt-1', {
        providerRequestId: 'req-new',
        returnedModel: 'model-1',
        latencyMs: 37,
      })
    ).rejects.toBeInstanceOf(ThemeProviderPersistenceConflictError);
    await expect(
      recordThemeProviderMetadata(client, 'attempt-2', {
        providerRequestId: null,
        returnedModel: null,
        latencyMs: -1,
      })
    ).rejects.toThrow('invalid_theme_provider_metadata');
    await expect(
      recordThemeProviderMetadata(client, 'attempt-3', {
        providerRequestId: '',
        returnedModel: 'm'.repeat(256),
        latencyMs: 1,
      })
    ).rejects.toThrow('invalid_theme_provider_metadata');
  });
});

describe('semantic batch persistence', () => {
  it('inserts the ordered, bounded snapshot and accepts an exact replay', async () => {
    let stored: Record<string, unknown> | undefined;
    const client = queryClient((text, values) => {
      if (text.includes('INSERT INTO theme_semantic_adjudication_batches')) {
        stored = {
          candidate_content_hash: values?.[1],
          semantic_policy_fingerprint: values?.[2],
          pair_snapshot: JSON.parse(values?.[3] as string),
          pair_fingerprint: values?.[4],
        };
        return { rows: [] };
      }
      if (text.includes('SELECT candidate_content_hash')) return { rows: stored ? [stored] : [] };
      return { rows: [] };
    });
    const request = {
      candidateId: 'candidate-1',
      candidateContentHash: hash,
      semanticPolicyFingerprint: 'b'.repeat(64),
      pairs: [
        { pairKey: 'pair-a', input: { evidence: 'one' } },
        { pairKey: 'pair-b', input: { evidence: 'two' } },
      ],
    };
    await persistThemeSemanticBatch(client, request);
    await persistThemeSemanticBatch(client, structuredClone(request));
    expect(client.query).toHaveBeenCalledTimes(4);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO theme_semantic_adjudication_batches'),
      expect.arrayContaining([
        'candidate-1',
        hash,
        'b'.repeat(64),
        expect.stringContaining('pair-a'),
        expect.any(String),
      ])
    );
    expect(stored?.pair_snapshot as unknown[]).toHaveLength(2);
    expect(stored?.pair_snapshot).toEqual([
      { pairKey: 'pair-a', input: { evidence: 'one' } },
      { pairKey: 'pair-b', input: { evidence: 'two' } },
    ]);
  });

  it('rejects changed content, policy, order, or more than four pairs', async () => {
    let stored: Record<string, unknown> | undefined;
    const client = queryClient((text, values) => {
      if (text.includes('INSERT INTO theme_semantic_adjudication_batches')) {
        stored ??= {
          candidate_content_hash: values?.[1],
          semantic_policy_fingerprint: values?.[2],
          pair_snapshot: JSON.parse(values?.[3] as string),
          pair_fingerprint: values?.[4],
        };
        return { rows: [] };
      }
      if (text.includes('SELECT candidate_content_hash')) return { rows: stored ? [stored] : [] };
      return { rows: [] };
    });
    const request = {
      candidateId: 'candidate-1',
      candidateContentHash: hash,
      semanticPolicyFingerprint: 'b'.repeat(64),
      pairs: [
        { pairKey: 'pair-a', input: 'first' },
        { pairKey: 'pair-b', input: 'second' },
      ],
    };
    await persistThemeSemanticBatch(client, request);
    await expect(
      persistThemeSemanticBatch(client, { ...request, candidateContentHash: 'e'.repeat(64) })
    ).rejects.toBeInstanceOf(ThemeProviderPersistenceConflictError);
    await expect(
      persistThemeSemanticBatch(client, { ...request, semanticPolicyFingerprint: 'f'.repeat(64) })
    ).rejects.toBeInstanceOf(ThemeProviderPersistenceConflictError);
    await expect(
      persistThemeSemanticBatch(client, { ...request, pairs: [...request.pairs].reverse() })
    ).rejects.toBeInstanceOf(ThemeProviderPersistenceConflictError);
    await expect(
      persistThemeSemanticBatch(client, {
        ...request,
        pairs: Array.from({ length: 5 }, (_, index) => ({
          pairKey: `pair-${index}`,
          input: index,
        })),
      })
    ).rejects.toThrow('invalid_theme_semantic_batch');
  });

  it('accepts and durably fingerprints an empty semantic batch', async () => {
    let stored: Record<string, unknown> | undefined;
    const client = queryClient((text, values) => {
      if (text.includes('INSERT INTO theme_semantic_adjudication_batches')) {
        stored = {
          candidate_content_hash: values?.[1],
          semantic_policy_fingerprint: values?.[2],
          pair_snapshot: JSON.parse(values?.[3] as string),
          pair_fingerprint: values?.[4],
        };
        return { rows: [] };
      }
      if (text.includes('SELECT candidate_content_hash')) return { rows: stored ? [stored] : [] };
      return { rows: [] };
    });
    const request = {
      candidateId: 'candidate-empty',
      candidateContentHash: hash,
      semanticPolicyFingerprint: 'b'.repeat(64),
      pairs: [],
    };
    await persistThemeSemanticBatch(client, request);
    expect(stored?.pair_snapshot).toEqual([]);
    await persistThemeSemanticBatch(client, request);
    expect(client.query).toHaveBeenCalledTimes(4);
  });

  it('rejects snapshots above the durable size bound', async () => {
    const client = queryClient(() => ({ rows: [] }));
    await expect(
      persistThemeSemanticBatch(client, {
        candidateId: 'candidate-large',
        candidateContentHash: hash,
        semanticPolicyFingerprint: 'b'.repeat(64),
        pairs: [{ pairKey: 'pair-large', input: { evidence: 'x'.repeat(262_144) } }],
      })
    ).rejects.toThrow('invalid_theme_semantic_batch');
    expect(client.query).not.toHaveBeenCalled();
  });
});
