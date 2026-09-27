import { createHash } from 'node:crypto';
import { isIP } from 'node:net';

import {
  resolveThemeSourceUrl,
  type ThemeSourceRegistry,
  type ThemeSourceRegistryEntry,
} from '@shared/models/theme-source-registry';
import {
  THEME_RELIABILITY_CONTRACT_VERSION,
  type RetrievalFailure,
} from '@shared/models/theme-evidence';

import {
  resolvePublicSourceAddresses,
  SourceAddressError,
  type SourceLookup,
} from './theme-source-address';
import {
  createPinnedHttpsTransport,
  MAX_SOURCE_BYTES,
  SourceHttpError,
  type SourceHopResponse,
  type SourceTransport,
} from './theme-source-https';

export const THEME_SOURCE_RETRIEVAL_POLICY_VERSION = 'theme-source-retrieval-v1';
export const MAX_SOURCE_REDIRECTS = 3;
const OVERALL_MS = 10_000;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SourceRegistryReader {
  get(version: string): Promise<{ manifest: ThemeSourceRegistry; hash: string } | null>;
}

export interface RetrievedThemeSource {
  requestedUrl: string;
  finalUrl: string;
  hops: string[];
  sourcePolicyVersion: string;
  registryHash: string;
  entryId: string;
  publisherId: string;
  publisher: string;
  originGroup: string;
  sourceClass: ThemeSourceRegistryEntry['sourceClass'];
  retrievalPolicyVersion: typeof THEME_SOURCE_RETRIEVAL_POLICY_VERSION;
  retrievedAt: string;
  httpStatus: 200;
  mediaType: 'text/html' | 'text/plain';
  contentHash: string;
  body: Buffer;
}

export type SourceRetrievalResult =
  | { ok: true; value: RetrievedThemeSource }
  | { ok: false; failure: RetrievalFailure };

function failure(
  code: RetrievalFailure['code'],
  provider: string | null,
  httpStatus: number | null = null
): SourceRetrievalResult {
  return {
    ok: false,
    failure: {
      contractVersion: THEME_RELIABILITY_CONTRACT_VERSION,
      code,
      retryable:
        code === 'timeout' || code === 'provider_unavailable' || code === 'provider_rate_limited',
      provider,
      httpStatus,
    },
  };
}

function oneHeader(response: SourceHopResponse, name: string): string | null {
  const values = response.headers[name] ?? [];
  return values.length === 1 ? values[0] : null;
}

function validMediaType(value: string | null): 'text/html' | 'text/plain' | null {
  if (!value || value.length > 255) return null;
  const match = /^\s*(text\/(?:html|plain))(?:\s*;\s*charset=[a-zA-Z0-9._-]{1,40})?\s*$/i.exec(
    value
  );
  return (match?.[1].toLowerCase() as 'text/html' | 'text/plain') ?? null;
}

function noIpLiteral(hostname: string): boolean {
  return isIP(hostname.replace(/^\[|\]$/g, '')) === 0;
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new SourceHttpError('timeout');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new SourceHttpError('timeout'));
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function retrieveThemeSource(
  input: { requestedUrl: string; sourcePolicyVersion: string },
  deps: {
    registry: SourceRegistryReader;
    lookup?: SourceLookup;
    transport?: SourceTransport;
    now?: () => number;
  }
): Promise<SourceRetrievalResult> {
  const now = deps.now ?? Date.now;
  const deadlineAt = now() + OVERALL_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OVERALL_MS);
  let provider: string | null = null;
  try {
    const stored = await withAbort(deps.registry.get(input.sourcePolicyVersion), controller.signal);
    if (!stored || stored.manifest.sourcePolicyVersion !== input.sourcePolicyVersion)
      return failure('invalid_url', null);
    const transport = deps.transport ?? createPinnedHttpsTransport();
    let current = input.requestedUrl;
    const hops: string[] = [];
    let initialEntry: ThemeSourceRegistryEntry | null = null;
    for (let redirects = 0; redirects <= MAX_SOURCE_REDIRECTS; redirects++) {
      const resolution = resolveThemeSourceUrl(stored.manifest, current);
      if (resolution.status !== 'matched')
        return failure(redirects ? 'redirect_blocked' : 'invalid_url', provider);
      const url = new URL(current);
      if (!noIpLiteral(url.hostname))
        return failure(redirects ? 'redirect_blocked' : 'blocked_address', provider);
      if (initialEntry && initialEntry.id !== resolution.entry.id)
        return failure('redirect_blocked', provider);
      initialEntry ??= resolution.entry;
      provider = initialEntry.publisherId;
      if (hops.includes(url.href)) return failure('redirect_blocked', provider);
      hops.push(url.href);
      const addresses = await resolvePublicSourceAddresses(
        url.hostname,
        deps.lookup,
        deadlineAt,
        now
      );
      const response = await withAbort(
        transport({ url, address: addresses[0], signal: controller.signal }),
        controller.signal
      );
      if (REDIRECT_STATUSES.has(response.status)) {
        if (redirects === MAX_SOURCE_REDIRECTS) return failure('redirect_limit', provider);
        const location = oneHeader(response, 'location');
        if (!location || location.length > 4096 || /[\u0000-\u0020\u007f\\]/.test(location))
          return failure('redirect_blocked', provider);
        try {
          current = new URL(location, url).href;
        } catch {
          return failure('redirect_blocked', provider);
        }
        continue;
      }
      if (response.status !== 200)
        return failure(
          response.status === 429 ? 'provider_rate_limited' : 'http_error',
          provider,
          response.status >= 100 && response.status <= 599 ? response.status : null
        );
      const encodings = response.headers['content-encoding'] ?? [];
      if (
        encodings.length > 1 ||
        (encodings.length === 1 && encodings[0].toLowerCase() !== 'identity')
      )
        return failure('unreadable_content', provider);
      const mediaType = validMediaType(oneHeader(response, 'content-type'));
      if (!mediaType) return failure('unsupported_content_type', provider);
      if (!Buffer.isBuffer(response.body) || response.body.length === 0)
        return failure('unreadable_content', provider);
      if (response.body.length > MAX_SOURCE_BYTES) return failure('response_too_large', provider);
      return {
        ok: true,
        value: {
          requestedUrl: input.requestedUrl,
          finalUrl: url.href,
          hops,
          sourcePolicyVersion: input.sourcePolicyVersion,
          registryHash: stored.hash,
          entryId: initialEntry.id,
          publisherId: initialEntry.publisherId,
          publisher: initialEntry.publisherName,
          originGroup: initialEntry.originGroup,
          sourceClass: initialEntry.sourceClass,
          retrievalPolicyVersion: THEME_SOURCE_RETRIEVAL_POLICY_VERSION,
          retrievedAt: new Date(now()).toISOString(),
          httpStatus: 200,
          mediaType,
          contentHash: createHash('sha256').update(response.body).digest('hex'),
          body: response.body,
        },
      };
    }
    return failure('redirect_limit', provider);
  } catch (error) {
    if (error instanceof SourceAddressError || error instanceof SourceHttpError)
      return failure(error.code, provider);
    return failure('provider_unavailable', provider);
  } finally {
    clearTimeout(timer);
  }
}
