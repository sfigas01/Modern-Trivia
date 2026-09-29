import { z } from 'zod';

import { sourceClassSchema } from './theme-evidence';

export const THEME_SOURCE_REGISTRY_CONTRACT_VERSION = 'theme-source-registry-v1' as const;
const identifier = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,254}$/);
const label = z.string().trim().min(1).max(255);
const scopeValue = z.string().trim().min(1).max(100);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
  });

function safePath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || /[?#*\\%]/.test(path)) return false;
  try {
    return new URL(path, 'https://example.invalid').pathname === path;
  } catch {
    return false;
  }
}

export const sourcePathSchema = z
  .object({ kind: z.enum(['exact', 'subtree']), path: z.string().min(1).max(2048) })
  .strict()
  .refine(({ path }) => safePath(path), { path: ['path'], message: 'unsafe path' })
  .refine(({ kind, path }) => kind !== 'subtree' || path.endsWith('/'), {
    path: ['path'],
    message: 'subtree path must end in /',
  });

export const sourceOriginSchema = z
  .object({ origin: z.string().max(255), paths: z.array(sourcePathSchema).min(1).max(50) })
  .strict()
  .refine(
    ({ origin }) => {
      try {
        const url = new URL(origin);
        return (
          /^https:\/\/[^/?#]+$/.test(origin) &&
          url.origin === origin &&
          !url.username &&
          !url.password &&
          !url.port
        );
      } catch {
        return false;
      }
    },
    { path: ['origin'], message: 'origin must be canonical HTTPS on port 443' }
  );

export const sourceRegistryEntrySchema = z
  .object({
    id: identifier,
    publisherId: identifier,
    publisherName: label,
    originGroup: identifier,
    sourceClass: sourceClassSchema,
    scope: z
      .object({
        topics: z.array(scopeValue).max(20),
        languages: z
          .array(z.string().regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/))
          .min(1)
          .max(20),
        geographies: z.array(scopeValue).max(20),
        temporal: z.object({ from: date, through: date }).strict().nullable(),
      })
      .strict(),
    origins: z.array(sourceOriginSchema).min(1).max(20),
  })
  .strict();

type RegistryPattern = {
  entryId: string;
  origin: string;
  kind: 'exact' | 'subtree';
  path: string;
};

type PathNode = {
  children: Map<string, PathNode>;
  exactOwners: Set<string>;
  subtreeOwners: Set<string>;
  descendantOwners: Set<string>;
};

function pathNode(): PathNode {
  return {
    children: new Map(),
    exactOwners: new Set(),
    subtreeOwners: new Set(),
    descendantOwners: new Set(),
  };
}

function hasOtherOwner(owners: Set<string>, entryId: string): boolean {
  return owners.size > (owners.has(entryId) ? 1 : 0);
}

function hasAmbiguousPatterns(patterns: RegistryPattern[]): boolean {
  const roots = new Map<string, PathNode>();
  for (const pattern of patterns) {
    const root = roots.get(pattern.origin) ?? pathNode();
    roots.set(pattern.origin, root);
    const visited = [root];
    let node = root;
    for (const character of pattern.path) {
      const child = node.children.get(character) ?? pathNode();
      node.children.set(character, child);
      node = child;
      visited.push(node);
      if (hasOtherOwner(node.subtreeOwners, pattern.entryId)) return true;
    }
    if (
      hasOtherOwner(node.exactOwners, pattern.entryId) ||
      hasOtherOwner(node.subtreeOwners, pattern.entryId) ||
      (pattern.kind === 'subtree' && hasOtherOwner(node.descendantOwners, pattern.entryId))
    )
      return true;
    for (const visitedNode of visited) visitedNode.descendantOwners.add(pattern.entryId);
    (pattern.kind === 'exact' ? node.exactOwners : node.subtreeOwners).add(pattern.entryId);
  }
  return false;
}

export const themeSourceRegistrySchema = z
  .object({
    contractVersion: z.literal(THEME_SOURCE_REGISTRY_CONTRACT_VERSION),
    sourcePolicyVersion: identifier,
    entries: z.array(sourceRegistryEntrySchema).min(1).max(200),
  })
  .strict()
  .superRefine((manifest, context) => {
    const ids = new Set<string>();
    const publishers = new Map<string, string>();
    const patterns: RegistryPattern[] = [];
    for (let index = 0; index < manifest.entries.length; index++) {
      const entry = manifest.entries[index];
      if (ids.has(entry.id))
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'id'],
          message: 'duplicate entry id',
        });
      ids.add(entry.id);
      const identity = `${entry.publisherName}\0${entry.originGroup}`;
      if (publishers.has(entry.publisherId) && publishers.get(entry.publisherId) !== identity)
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'publisherId'],
          message: 'inconsistent publisher identity',
        });
      publishers.set(entry.publisherId, identity);
      if (entry.scope.temporal && entry.scope.temporal.from > entry.scope.temporal.through)
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'scope', 'temporal'],
          message: 'invalid temporal range',
        });
      for (const field of ['topics', 'languages', 'geographies'] as const)
        if (new Set(entry.scope[field]).size !== entry.scope[field].length)
          context.addIssue({
            code: 'custom',
            path: ['entries', index, 'scope', field],
            message: 'duplicate scope value',
          });
      if (
        entry.origins.reduce(
          (total: number, origin: (typeof entry.origins)[number]) => total + origin.paths.length,
          0
        ) > 50
      )
        context.addIssue({
          code: 'custom',
          path: ['entries', index, 'origins'],
          message: 'more than 50 paths',
        });
      const origins = new Set<string>();
      for (let originIndex = 0; originIndex < entry.origins.length; originIndex++) {
        const origin = entry.origins[originIndex];
        if (origins.has(origin.origin))
          context.addIssue({
            code: 'custom',
            path: ['entries', index, 'origins', originIndex],
            message: 'duplicate origin',
          });
        origins.add(origin.origin);
        const paths = new Set<string>();
        for (const path of origin.paths) {
          const key = `${path.kind}:${path.path}`;
          if (paths.has(key))
            context.addIssue({
              code: 'custom',
              path: ['entries', index, 'origins', originIndex, 'paths'],
              message: 'duplicate path',
            });
          paths.add(key);
          patterns.push({ entryId: entry.id, origin: origin.origin, ...path });
        }
      }
    }
    if (hasAmbiguousPatterns(patterns))
      context.addIssue({
        code: 'custom',
        path: ['entries'],
        message: 'ambiguous URL match between registry entries',
      });
  });

export type ThemeSourceRegistry = z.infer<typeof themeSourceRegistrySchema>;
export type ThemeSourceRegistryEntry = ThemeSourceRegistry['entries'][number];
const sort = <T>(items: T[], key: (item: T) => string) =>
  [...items].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

export function canonicalizeThemeSourceRegistry(input: ThemeSourceRegistry): ThemeSourceRegistry {
  const manifest = themeSourceRegistrySchema.parse(input);
  return {
    ...manifest,
    entries: sort(manifest.entries, (entry) => entry.id).map((entry) => ({
      ...entry,
      scope: {
        ...entry.scope,
        topics: sort(entry.scope.topics, String),
        languages: sort(entry.scope.languages, String),
        geographies: sort(entry.scope.geographies, String),
      },
      origins: sort(entry.origins, (origin) => origin.origin).map((origin) => ({
        ...origin,
        paths: sort(origin.paths, (path) => `${path.kind}:${path.path}`),
      })),
    })),
  };
}

export type ThemeSourceResolution =
  | { status: 'matched'; entry: ThemeSourceRegistryEntry }
  | { status: 'missing' | 'invalid_url' | 'not_allowed' | 'ambiguous' };
export function resolveThemeSourceUrl(
  manifest: ThemeSourceRegistry | null,
  requestedUrl: string
): ThemeSourceResolution {
  if (!manifest) return { status: 'missing' };
  if (
    requestedUrl.length > 4096 ||
    /[\u0000-\u0020\u007f\\]/.test(requestedUrl) ||
    /%(?![a-f0-9]{2})/i.test(requestedUrl) ||
    /%(?:2f|5c|2e|25|0[0-9a-f]|1[0-9a-f]|7f)/i.test(requestedUrl)
  )
    return { status: 'invalid_url' };
  let url: URL;
  try {
    url = new URL(requestedUrl);
  } catch {
    return { status: 'invalid_url' };
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    !url.hostname
  )
    return { status: 'invalid_url' };
  const matches = manifest.entries.filter((entry) =>
    entry.origins.some(
      (origin) =>
        origin.origin === url.origin &&
        origin.paths.some((path) =>
          path.kind === 'exact' ? url.pathname === path.path : url.pathname.startsWith(path.path)
        )
    )
  );
  if (matches.length > 1) return { status: 'ambiguous' };
  return matches[0] ? { status: 'matched', entry: matches[0] } : { status: 'not_allowed' };
}
