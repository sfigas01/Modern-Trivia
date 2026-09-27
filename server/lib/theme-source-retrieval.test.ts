import { createHash } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import type { ThemeSourceRegistry } from '@shared/models/theme-source-registry';

import { retrieveThemeSource } from './theme-source-retrieval';
import type { SourceHopResponse } from './theme-source-https';

const manifest: ThemeSourceRegistry = {
  contractVersion: 'theme-source-registry-v1',
  sourcePolicyVersion: 'source-v1',
  entries: [
    {
      id: 'wikipedia-en',
      publisherId: 'wikimedia',
      publisherName: 'Wikipedia',
      originGroup: 'wikimedia',
      sourceClass: 'secondary_reputable',
      scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
      origins: [
        { origin: 'https://en.wikipedia.org', paths: [{ kind: 'subtree', path: '/wiki/' }] },
      ],
    },
    {
      id: 'other',
      publisherId: 'other',
      publisherName: 'Other',
      originGroup: 'other',
      sourceClass: 'primary_record',
      scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
      origins: [
        { origin: 'https://other.example.org', paths: [{ kind: 'subtree', path: '/records/' }] },
      ],
    },
  ],
};
const requestedUrl = 'https://en.wikipedia.org/wiki/Trivia';
const body = Buffer.from('<h1>Trivia</h1>');
const success: SourceHopResponse = {
  status: 200,
  headers: { 'content-type': ['text/html; charset=utf-8'] },
  body,
};

function harness(responses: SourceHopResponse[] = [success]) {
  const lookup = vi.fn().mockResolvedValue([
    { address: '208.80.154.224', family: 4 },
    { address: '2620:0:861:ed1a::1', family: 6 },
  ]);
  const transport = vi.fn().mockImplementation(async () => responses.shift() ?? success);
  const registry = { get: vi.fn().mockResolvedValue({ manifest, hash: 'a'.repeat(64) }) };
  const run = (url = requestedUrl) =>
    retrieveThemeSource(
      { requestedUrl: url, sourcePolicyVersion: 'source-v1' },
      { registry, lookup, transport, now: () => 1_000 }
    );
  return { run, lookup, transport, registry };
}

describe('theme source retrieval', () => {
  it('returns exact bytes and bound provenance for broad Wikipedia coverage', async () => {
    const { run, lookup, transport, registry } = harness();
    const result = await run();
    expect(result).toMatchObject({
      ok: true,
      value: {
        requestedUrl,
        finalUrl: requestedUrl,
        hops: [requestedUrl],
        sourcePolicyVersion: 'source-v1',
        registryHash: 'a'.repeat(64),
        entryId: 'wikipedia-en',
        publisher: 'Wikipedia',
        sourceClass: 'secondary_reputable',
        retrievalPolicyVersion: 'theme-source-retrieval-v1',
        retrievedAt: new Date(1_000).toISOString(),
        httpStatus: 200,
        mediaType: 'text/html',
        contentHash: createHash('sha256').update(body).digest('hex'),
        body,
      },
    });
    expect(registry.get).toHaveBeenCalledWith('source-v1');
    expect(lookup).toHaveBeenCalledWith('en.wikipedia.org', { all: true, verbatim: true });
    expect(transport.mock.calls[0][0].address).toEqual({ address: '208.80.154.224', family: 4 });
  });

  it('revalidates DNS and the same registry entry for every redirect', async () => {
    const next = 'https://en.wikipedia.org/wiki/History';
    const { run, lookup, transport } = harness([
      { status: 302, headers: { location: ['/wiki/History'] }, body: Buffer.alloc(0) },
      success,
    ]);
    expect(await run()).toMatchObject({
      ok: true,
      value: { hops: [requestedUrl, next], finalUrl: next },
    });
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(transport).toHaveBeenCalledTimes(2);
    const blocked = harness([
      {
        status: 302,
        headers: { location: ['https://other.example.org/records/a'] },
        body: Buffer.alloc(0),
      },
    ]);
    expect(await blocked.run()).toMatchObject({ ok: false, failure: { code: 'redirect_blocked' } });
    expect(blocked.transport).toHaveBeenCalledTimes(1);
  });

  it('rejects loops, excess hops, invalid destinations, and mixed DNS', async () => {
    const redirect = (location: string): SourceHopResponse => ({
      status: 301,
      headers: { location: [location] },
      body: Buffer.alloc(0),
    });
    expect(await harness([redirect(requestedUrl)]).run()).toMatchObject({
      ok: false,
      failure: { code: 'redirect_blocked' },
    });
    expect(
      await harness([
        redirect('/wiki/1'),
        redirect('/wiki/2'),
        redirect('/wiki/3'),
        redirect('/wiki/4'),
      ]).run()
    ).toMatchObject({ ok: false, failure: { code: 'redirect_limit' } });
    expect(await harness([redirect('http://en.wikipedia.org/wiki/1')]).run()).toMatchObject({
      ok: false,
      failure: { code: 'redirect_blocked' },
    });
    const mixed = harness();
    mixed.lookup.mockResolvedValueOnce([
      { address: '208.80.154.224', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    expect(await mixed.run()).toMatchObject({ ok: false, failure: { code: 'blocked_address' } });
    expect(mixed.transport).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...success, status: 206 }, 'http_error'],
    [{ ...success, status: 304 }, 'http_error'],
    [{ ...success, headers: {} }, 'unsupported_content_type'],
    [
      { ...success, headers: { 'content-type': ['text/html', 'text/plain'] } },
      'unsupported_content_type',
    ],
    [{ ...success, headers: { 'content-type': ['application/json'] } }, 'unsupported_content_type'],
    [
      { ...success, headers: { 'content-type': ['text/html'], 'content-encoding': ['gzip'] } },
      'unreadable_content',
    ],
    [{ ...success, body: Buffer.alloc(0) }, 'unreadable_content'],
    [{ ...success, body: Buffer.alloc(2 * 1024 * 1024 + 1) }, 'response_too_large'],
  ] as const)('rejects invalid response as %s', async (response, code) => {
    expect(await harness([response]).run()).toMatchObject({ ok: false, failure: { code } });
  });

  it('never returns raw transport errors or bodies in failures', async () => {
    const h = harness();
    h.transport.mockRejectedValueOnce(new Error('secret response body'));
    expect(await h.run()).toEqual({
      ok: false,
      failure: {
        contractVersion: 'theme-reliability-v1',
        code: 'provider_unavailable',
        retryable: true,
        provider: 'wikimedia',
        httpStatus: null,
      },
    });
  });
});
