import { describe, expect, it, vi } from 'vitest';

import {
  createWikipediaDiscoveryPolicy,
  createWikipediaSourceRegistry,
  discoverWikipediaSources,
  normalizeWikipediaTheme,
  WIKIPEDIA_API_ENDPOINT,
} from './theme-wikipedia-discovery';
import { hashThemeSourceRegistry } from './theme-source-registry';
import { MAX_SOURCE_BYTES, SourceHttpError, type SourceHopResponse } from './theme-source-https';

const sourcePolicyVersion = 'wikipedia-preview-v1';
const manifest = createWikipediaSourceRegistry(sourcePolicyVersion);
const registry = { manifest, hash: hashThemeSourceRegistry(manifest) };
const policy = createWikipediaDiscoveryPolicy({
  discoveryPolicyVersion: 'wikipedia-discovery-v1',
  sourcePolicyVersion,
  sourceRegistryHash: registry.hash,
  maximumResults: 4,
  minimumResults: 2,
});

function response(payload: unknown, overrides: Partial<SourceHopResponse> = {}): SourceHopResponse {
  return {
    status: 200,
    headers: { 'content-type': ['application/json; charset=utf-8'] },
    body: Buffer.from(JSON.stringify(payload)),
    ...overrides,
  };
}

function harness(payload: unknown) {
  const lookup = vi.fn().mockResolvedValue([{ address: '208.80.154.224', family: 4 }]);
  const transport = vi.fn().mockResolvedValue(response(payload));
  const run = (theme = '  World   Baseball   Classic  ') =>
    discoverWikipediaSources({ theme, policy }, { registry, lookup, transport, now: () => 1_000 });
  return { run, lookup, transport };
}

const pages = {
  batchcomplete: true,
  query: {
    pages: [
      {
        pageid: 20,
        ns: 0,
        title: 'World Baseball Classic',
        index: 2,
        canonicalurl: 'https://en.wikipedia.org/wiki/World_Baseball_Classic',
      },
      {
        pageid: 10,
        ns: 0,
        title: '2006 World Baseball Classic',
        index: 1,
        canonicalurl: 'https://en.wikipedia.org/wiki/2006_World_Baseball_Classic',
      },
      {
        pageid: 30,
        ns: 0,
        title: 'World Baseball Classic (disambiguation)',
        index: 3,
        canonicalurl: 'https://en.wikipedia.org/wiki/World_Baseball_Classic_(disambiguation)',
        pageprops: { disambiguation: '' },
      },
    ],
  },
};

describe('Wikipedia source discovery', () => {
  it('normalizes the theme, builds a fixed bounded request, and preserves declared rank', async () => {
    const h = harness(pages);
    await expect(h.run()).resolves.toMatchObject({
      ok: true,
      value: {
        normalizedTheme: 'World Baseball Classic',
        sources: [
          {
            pageId: 10,
            rank: 1,
            canonicalUrl: 'https://en.wikipedia.org/wiki/2006_World_Baseball_Classic',
          },
          {
            pageId: 20,
            rank: 2,
            canonicalUrl: 'https://en.wikipedia.org/wiki/World_Baseball_Classic',
          },
        ],
      },
    });
    expect(h.lookup).toHaveBeenCalledWith('en.wikipedia.org', { all: true, verbatim: true });
    const requested = h.transport.mock.calls[0][0].url as URL;
    expect(`${requested.origin}${requested.pathname}`).toBe(WIKIPEDIA_API_ENDPOINT);
    expect(Object.fromEntries(requested.searchParams)).toMatchObject({
      action: 'query',
      generator: 'search',
      gsrsearch: 'World Baseball Classic',
      gsrnamespace: '0',
      gsrlimit: '4',
      format: 'json',
      formatversion: '2',
    });
    expect(h.transport).toHaveBeenCalledOnce();
  });

  it('rejects invalid themes before DNS or transport work', async () => {
    const h = harness(pages);
    expect(normalizeWikipediaTheme('  Montréal  ')).toBe('Montréal');
    expect(normalizeWikipediaTheme('bad\nquery')).toBeNull();
    await expect(h.run('bad\nquery')).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid_request', retryable: false },
    });
    expect(h.lookup).not.toHaveBeenCalled();
    expect(h.transport).not.toHaveBeenCalled();
  });

  it('fails closed on registry drift and ineligible article URLs', async () => {
    const h = harness({
      query: {
        pages: [
          {
            pageid: 1,
            ns: 0,
            title: 'Wrong host',
            index: 1,
            canonicalurl: 'https://example.com/wiki/Wrong_host',
          },
          {
            pageid: 2,
            ns: 0,
            title: 'Second',
            index: 2,
            canonicalurl: 'https://en.wikipedia.org/wiki/Second',
          },
        ],
      },
    });
    await expect(h.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid_response' },
    });
    await expect(
      discoverWikipediaSources(
        { theme: 'Baseball', policy },
        {
          registry: { ...registry, hash: 'b'.repeat(64) },
          lookup: h.lookup,
          transport: h.transport,
        }
      )
    ).resolves.toMatchObject({ ok: false, failure: { code: 'policy_mismatch' } });
    await expect(
      discoverWikipediaSources(
        { theme: 'Baseball', policy },
        {
          registry: { manifest: { ...manifest, entries: [] }, hash: registry.hash },
          lookup: h.lookup,
          transport: h.transport,
        }
      )
    ).resolves.toMatchObject({ ok: false, failure: { code: 'policy_mismatch' } });
  });

  it('rejects duplicate pages and incomplete eligible inventory', async () => {
    const duplicate = harness({
      query: { pages: [pages.query.pages[0], { ...pages.query.pages[0], index: 4 }] },
    });
    await expect(duplicate.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid_response' },
    });
    const duplicateRank = harness({
      query: { pages: [pages.query.pages[0], { ...pages.query.pages[1], index: 2 }] },
    });
    await expect(duplicateRank.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid_response' },
    });
    const short = harness({ query: { pages: [pages.query.pages[0], pages.query.pages[2]] } });
    await expect(short.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'insufficient_results', retryable: false },
    });
  });

  it('enforces the configured result boundaries', () => {
    expect(() =>
      createWikipediaDiscoveryPolicy({
        discoveryPolicyVersion: 'too-many',
        sourcePolicyVersion,
        sourceRegistryHash: registry.hash,
        maximumResults: 21,
        minimumResults: 1,
      })
    ).toThrow();
    expect(() =>
      createWikipediaDiscoveryPolicy({
        discoveryPolicyVersion: 'inverted',
        sourcePolicyVersion,
        sourceRegistryHash: registry.hash,
        maximumResults: 2,
        minimumResults: 3,
      })
    ).toThrow();
  });

  it('maps provider and transport failures without retrying', async () => {
    const limited = harness(pages);
    limited.transport.mockResolvedValueOnce(
      response({}, { status: 429, headers: {}, body: Buffer.alloc(0) })
    );
    await expect(limited.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'provider_rate_limited', retryable: true, httpStatus: 429 },
    });
    expect(limited.transport).toHaveBeenCalledOnce();

    const timedOut = harness(pages);
    timedOut.transport.mockRejectedValueOnce(new SourceHttpError('timeout'));
    await expect(timedOut.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'timeout', retryable: true },
    });
    expect(timedOut.transport).toHaveBeenCalledOnce();
  });

  it('rejects API errors, malformed JSON, and non-JSON responses', async () => {
    const apiError = harness({ error: { code: 'badrequest', info: 'bad' } });
    await expect(apiError.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'provider_rejected' },
    });

    const malformed = harness(pages);
    malformed.transport.mockResolvedValueOnce(response({}, { body: Buffer.from('{not json') }));
    await expect(malformed.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid_response' },
    });

    const html = harness(pages);
    html.transport.mockResolvedValueOnce(
      response({}, { headers: { 'content-type': ['text/html'] } })
    );
    await expect(html.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid_response' },
    });

    const compressed = harness(pages);
    compressed.transport.mockResolvedValueOnce(
      response(pages, {
        headers: { 'content-type': ['application/json'], 'content-encoding': ['gzip'] },
      })
    );
    await expect(compressed.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'invalid_response' },
    });

    const oversized = harness(pages);
    oversized.transport.mockResolvedValueOnce(
      response({}, { body: Buffer.alloc(MAX_SOURCE_BYTES + 1) })
    );
    await expect(oversized.run()).resolves.toMatchObject({
      ok: false,
      failure: { code: 'response_too_large' },
    });
  });
});
