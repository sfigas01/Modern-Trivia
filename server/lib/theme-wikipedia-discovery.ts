import { isIP } from 'node:net';

import { z } from 'zod';

import {
  canonicalizeThemeSourceRegistry,
  resolveThemeSourceUrl,
  type ThemeSourceRegistry,
} from '@shared/models/theme-source-registry';

import {
  resolvePublicSourceAddresses,
  SourceAddressError,
  type SourceLookup,
} from './theme-source-address';
import { hashThemeSourceRegistry } from './theme-source-registry';
import {
  createPinnedHttpsTransport,
  MAX_SOURCE_BYTES,
  SourceHttpError,
  type SourceHopResponse,
  type SourceTransport,
} from './theme-source-https';

export const THEME_WIKIPEDIA_DISCOVERY_CONTRACT_VERSION = 'theme-wikipedia-discovery-v1' as const;
export const WIKIPEDIA_API_ENDPOINT = 'https://en.wikipedia.org/w/api.php' as const;
export const WIKIPEDIA_SOURCE_ENTRY_ID = 'wikipedia-en' as const;
export const WIKIPEDIA_DISCOVERY_TIMEOUT_MS = 10_000;
export const WIKIPEDIA_DISCOVERY_USER_AGENT =
  'Modern-Trivia/1.0 (source discovery; https://superquestly.up.railway.app)' as const;

const identifierSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const wikipediaDiscoveryPolicySchema = z
  .object({
    contractVersion: z.literal(THEME_WIKIPEDIA_DISCOVERY_CONTRACT_VERSION),
    discoveryPolicyVersion: identifierSchema,
    endpoint: z.literal(WIKIPEDIA_API_ENDPOINT),
    language: z.literal('en'),
    namespace: z.literal(0),
    maximumResults: z.number().int().min(1).max(20),
    minimumResults: z.number().int().min(1).max(20),
    continuation: z.literal('none'),
    automaticRetries: z.literal(0),
    timeoutMs: z.literal(WIKIPEDIA_DISCOVERY_TIMEOUT_MS),
    sourcePolicyVersion: identifierSchema,
    sourceRegistryHash: sha256Schema,
    sourceEntryId: z.literal(WIKIPEDIA_SOURCE_ENTRY_ID),
  })
  .strict()
  .refine((policy) => policy.minimumResults <= policy.maximumResults, {
    path: ['minimumResults'],
    message: 'Minimum results cannot exceed maximum results',
  });

export type WikipediaDiscoveryPolicy = z.infer<typeof wikipediaDiscoveryPolicySchema>;

export const wikipediaDiscoveredSourceSchema = z
  .object({
    pageId: z.number().int().positive(),
    rank: z.number().int().positive().max(10_000),
    title: z.string().trim().min(1).max(500),
    language: z.literal('en'),
    canonicalUrl: z
      .string()
      .url()
      .refine((value) => {
        try {
          const url = new URL(value);
          return (
            url.origin === 'https://en.wikipedia.org' &&
            url.pathname.startsWith('/wiki/') &&
            !url.search &&
            !url.hash &&
            !url.username &&
            !url.password &&
            !url.port
          );
        } catch {
          return false;
        }
      }),
  })
  .strict();

export type WikipediaDiscoveredSource = z.infer<typeof wikipediaDiscoveredSourceSchema>;

export type WikipediaDiscoveryFailureCode =
  | 'invalid_request'
  | 'policy_mismatch'
  | 'blocked_address'
  | 'timeout'
  | 'response_too_large'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_rejected'
  | 'invalid_response'
  | 'source_ineligible'
  | 'insufficient_results';

export type WikipediaDiscoveryResult =
  | {
      ok: true;
      value: {
        contractVersion: typeof THEME_WIKIPEDIA_DISCOVERY_CONTRACT_VERSION;
        normalizedTheme: string;
        requestUrl: string;
        discoveryPolicy: WikipediaDiscoveryPolicy;
        sources: WikipediaDiscoveredSource[];
      };
    }
  | {
      ok: false;
      failure: {
        contractVersion: typeof THEME_WIKIPEDIA_DISCOVERY_CONTRACT_VERSION;
        code: WikipediaDiscoveryFailureCode;
        retryable: boolean;
        provider: 'wikipedia-en';
        httpStatus: number | null;
      };
    };

type StoredRegistry = Readonly<{ manifest: ThemeSourceRegistry; hash: string }>;

export type WikipediaDiscoveryDependencies = Readonly<{
  registry: StoredRegistry;
  lookup?: SourceLookup;
  transport?: SourceTransport;
  now?: () => number;
}>;

type ApiPage = {
  pageid?: unknown;
  ns?: unknown;
  title?: unknown;
  index?: unknown;
  canonicalurl?: unknown;
  missing?: unknown;
  pageprops?: unknown;
};

function failure(
  code: WikipediaDiscoveryFailureCode,
  httpStatus: number | null = null
): WikipediaDiscoveryResult {
  return {
    ok: false,
    failure: {
      contractVersion: THEME_WIKIPEDIA_DISCOVERY_CONTRACT_VERSION,
      code,
      retryable:
        code === 'timeout' || code === 'provider_rate_limited' || code === 'provider_unavailable',
      provider: 'wikipedia-en',
      httpStatus,
    },
  };
}

export function normalizeWikipediaTheme(theme: string): string | null {
  if (typeof theme !== 'string' || /[\u0000-\u001f\u007f]/.test(theme)) return null;
  const normalized = theme.normalize('NFKC').trim().replace(/\s+/g, ' ');
  if (normalized.length === 0 || normalized.length > 160) return null;
  return normalized;
}

export function createWikipediaSourceRegistry(sourcePolicyVersion: string): ThemeSourceRegistry {
  return canonicalizeThemeSourceRegistry({
    contractVersion: 'theme-source-registry-v1',
    sourcePolicyVersion,
    entries: [
      {
        id: WIKIPEDIA_SOURCE_ENTRY_ID,
        publisherId: 'wikimedia-foundation',
        publisherName: 'Wikipedia',
        originGroup: 'wikimedia-foundation',
        sourceClass: 'secondary_reputable',
        scope: { topics: [], languages: ['en'], geographies: [], temporal: null },
        origins: [
          {
            origin: 'https://en.wikipedia.org',
            paths: [{ kind: 'subtree', path: '/wiki/' }],
          },
        ],
      },
    ],
  });
}

export function createWikipediaDiscoveryPolicy(input: {
  discoveryPolicyVersion: string;
  sourcePolicyVersion: string;
  sourceRegistryHash: string;
  maximumResults: number;
  minimumResults: number;
}): WikipediaDiscoveryPolicy {
  return wikipediaDiscoveryPolicySchema.parse({
    contractVersion: THEME_WIKIPEDIA_DISCOVERY_CONTRACT_VERSION,
    discoveryPolicyVersion: input.discoveryPolicyVersion,
    endpoint: WIKIPEDIA_API_ENDPOINT,
    language: 'en',
    namespace: 0,
    maximumResults: input.maximumResults,
    minimumResults: input.minimumResults,
    continuation: 'none',
    automaticRetries: 0,
    timeoutMs: WIKIPEDIA_DISCOVERY_TIMEOUT_MS,
    sourcePolicyVersion: input.sourcePolicyVersion,
    sourceRegistryHash: input.sourceRegistryHash,
    sourceEntryId: WIKIPEDIA_SOURCE_ENTRY_ID,
  });
}

export function buildWikipediaDiscoveryRequestUrl(
  theme: string,
  policy: WikipediaDiscoveryPolicy
): URL {
  const url = new URL(policy.endpoint);
  url.searchParams.set('action', 'query');
  url.searchParams.set('generator', 'search');
  url.searchParams.set('gsrsearch', theme);
  url.searchParams.set('gsrnamespace', String(policy.namespace));
  url.searchParams.set('gsrlimit', String(policy.maximumResults));
  url.searchParams.set('prop', 'info|pageprops');
  url.searchParams.set('inprop', 'url');
  url.searchParams.set('ppprop', 'disambiguation');
  url.searchParams.set('redirects', '1');
  url.searchParams.set('format', 'json');
  url.searchParams.set('formatversion', '2');
  return url;
}

function oneHeader(response: SourceHopResponse, name: string): string | null {
  const values = response.headers[name] ?? [];
  return values.length === 1 ? values[0] : null;
}

function isJsonContentType(value: string | null): boolean {
  return Boolean(
    value && /^\s*application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(value)
  );
}

function parsePage(page: ApiPage): WikipediaDiscoveredSource | null {
  if (
    page.missing !== undefined ||
    page.ns !== 0 ||
    !Number.isInteger(page.pageid) ||
    Number(page.pageid) <= 0 ||
    !Number.isInteger(page.index) ||
    Number(page.index) <= 0 ||
    typeof page.title !== 'string' ||
    typeof page.canonicalurl !== 'string'
  )
    return null;
  if (
    page.pageprops &&
    typeof page.pageprops === 'object' &&
    Object.prototype.hasOwnProperty.call(page.pageprops, 'disambiguation')
  )
    return null;
  const parsed = wikipediaDiscoveredSourceSchema.safeParse({
    pageId: page.pageid,
    rank: page.index,
    title: page.title,
    language: 'en',
    canonicalUrl: page.canonicalurl,
  });
  return parsed.success ? parsed.data : null;
}

export async function discoverWikipediaSources(
  input: { theme: string; policy: WikipediaDiscoveryPolicy },
  deps: WikipediaDiscoveryDependencies
): Promise<WikipediaDiscoveryResult> {
  const policy = wikipediaDiscoveryPolicySchema.safeParse(input.policy);
  const normalizedTheme = normalizeWikipediaTheme(input.theme);
  if (!policy.success || !normalizedTheme) return failure('invalid_request');
  let manifest: ThemeSourceRegistry;
  try {
    manifest = canonicalizeThemeSourceRegistry(deps.registry.manifest);
  } catch {
    return failure('policy_mismatch');
  }
  if (
    manifest.sourcePolicyVersion !== policy.data.sourcePolicyVersion ||
    deps.registry.hash !== policy.data.sourceRegistryHash ||
    hashThemeSourceRegistry(manifest) !== deps.registry.hash ||
    !manifest.entries.some((entry) => entry.id === policy.data.sourceEntryId)
  )
    return failure('policy_mismatch');

  const requestUrl = buildWikipediaDiscoveryRequestUrl(normalizedTheme, policy.data);
  if (requestUrl.origin !== new URL(WIKIPEDIA_API_ENDPOINT).origin || isIP(requestUrl.hostname))
    return failure('policy_mismatch');

  const now = deps.now ?? Date.now;
  const deadlineAt = now() + policy.data.timeoutMs;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), policy.data.timeoutMs);
  try {
    const addresses = await resolvePublicSourceAddresses(
      requestUrl.hostname,
      deps.lookup,
      deadlineAt,
      now
    );
    const transport =
      deps.transport ??
      createPinnedHttpsTransport(undefined, {
        accept: 'application/json',
        userAgent: WIKIPEDIA_DISCOVERY_USER_AGENT,
      });
    const response = await transport({
      url: requestUrl,
      address: addresses[0],
      signal: controller.signal,
    });
    if (response.status === 429) return failure('provider_rate_limited', 429);
    if (response.status < 200 || response.status >= 300)
      return failure(
        response.status >= 400 && response.status < 500
          ? 'provider_rejected'
          : 'provider_unavailable',
        response.status >= 100 && response.status <= 599 ? response.status : null
      );
    const encodings = response.headers['content-encoding'] ?? [];
    if (Buffer.isBuffer(response.body) && response.body.length > MAX_SOURCE_BYTES)
      return failure('response_too_large', response.status);
    if (
      encodings.length > 1 ||
      (encodings.length === 1 && encodings[0].toLowerCase() !== 'identity') ||
      !Buffer.isBuffer(response.body) ||
      response.body.length === 0 ||
      !isJsonContentType(oneHeader(response, 'content-type'))
    )
      return failure('invalid_response', response.status);
    let payload: unknown;
    try {
      payload = JSON.parse(response.body.toString('utf8'));
    } catch {
      return failure('invalid_response', response.status);
    }
    if (!payload || typeof payload !== 'object' || 'error' in payload)
      return failure('provider_rejected', response.status);
    const query = (payload as { query?: unknown }).query;
    const pages =
      query && typeof query === 'object' && Array.isArray((query as { pages?: unknown }).pages)
        ? ((query as { pages: ApiPage[] }).pages ?? [])
        : [];
    if (pages.length > policy.data.maximumResults)
      return failure('invalid_response', response.status);
    const eligible: WikipediaDiscoveredSource[] = [];
    for (const page of pages) {
      if (!page || typeof page !== 'object') return failure('invalid_response', response.status);
      const parsed = parsePage(page);
      if (!parsed) {
        const disambiguation =
          page.pageprops &&
          typeof page.pageprops === 'object' &&
          Object.prototype.hasOwnProperty.call(page.pageprops, 'disambiguation');
        if (disambiguation) continue;
        return failure('invalid_response', response.status);
      }
      const resolution = resolveThemeSourceUrl(manifest, parsed.canonicalUrl);
      if (resolution.status !== 'matched' || resolution.entry.id !== policy.data.sourceEntryId)
        return failure('source_ineligible', response.status);
      eligible.push(parsed);
    }
    eligible.sort(
      (left, right) =>
        left.rank - right.rank ||
        left.pageId - right.pageId ||
        left.canonicalUrl.localeCompare(right.canonicalUrl)
    );
    const pageIds = new Set(eligible.map((source) => source.pageId));
    const ranks = new Set(eligible.map((source) => source.rank));
    const urls = new Set(eligible.map((source) => source.canonicalUrl));
    if (
      pageIds.size !== eligible.length ||
      ranks.size !== eligible.length ||
      urls.size !== eligible.length
    )
      return failure('invalid_response', response.status);
    if (eligible.length < policy.data.minimumResults)
      return failure('insufficient_results', response.status);
    return {
      ok: true,
      value: {
        contractVersion: THEME_WIKIPEDIA_DISCOVERY_CONTRACT_VERSION,
        normalizedTheme,
        requestUrl: requestUrl.href,
        discoveryPolicy: policy.data,
        sources: eligible.slice(0, policy.data.maximumResults),
      },
    };
  } catch (error) {
    if (error instanceof SourceAddressError || error instanceof SourceHttpError) {
      if (error.code === 'response_too_large') return failure('response_too_large');
      if (error.code === 'timeout') return failure('timeout');
      if (error instanceof SourceAddressError && error.code === 'blocked_address')
        return failure('blocked_address');
    }
    return failure(controller.signal.aborted ? 'timeout' : 'provider_unavailable');
  } finally {
    clearTimeout(timer);
  }
}
