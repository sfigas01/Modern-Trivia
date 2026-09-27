import { describe, expect, it } from 'vitest';

import {
  canonicalizeThemeSourceRegistry,
  resolveThemeSourceUrl,
  themeSourceRegistrySchema,
  type ThemeSourceRegistry,
} from './theme-source-registry';

export const fictionalRegistry: ThemeSourceRegistry = {
  contractVersion: 'theme-source-registry-v1',
  sourcePolicyVersion: 'fictional-policy-1',
  entries: [
    {
      id: 'fictional-archive',
      publisherId: 'fictional-publisher',
      publisherName: 'Fictional Archive',
      originGroup: 'fictional-archive-group',
      sourceClass: 'primary_record',
      scope: {
        topics: ['Imaginary history'],
        languages: ['en'],
        geographies: ['Fictional Island'],
        temporal: { from: '1900-01-01', through: '2100-12-31' },
      },
      origins: [
        {
          origin: 'https://archive.example.test',
          paths: [
            { kind: 'subtree', path: '/records/' },
            { kind: 'exact', path: '/index' },
          ],
        },
      ],
    },
  ],
};

describe('theme source registry contract', () => {
  it('requires a complete bounded manifest and rejects overlapping entries', () => {
    expect(themeSourceRegistrySchema.safeParse(fictionalRegistry).success).toBe(true);
    expect(themeSourceRegistrySchema.safeParse({ ...fictionalRegistry, extra: true }).success).toBe(
      false
    );
    expect(themeSourceRegistrySchema.safeParse({ ...fictionalRegistry, entries: [] }).success).toBe(
      false
    );
    expect(
      themeSourceRegistrySchema.safeParse({
        ...fictionalRegistry,
        entries: [...fictionalRegistry.entries, { ...fictionalRegistry.entries[0], id: 'other' }],
      }).success
    ).toBe(false);
    expect(
      themeSourceRegistrySchema.safeParse({
        ...fictionalRegistry,
        entries: [
          {
            ...fictionalRegistry.entries[0],
            origins: [
              { origin: 'http://archive.example.test', paths: [{ kind: 'exact', path: '/index' }] },
            ],
          },
        ],
      }).success
    ).toBe(false);
    expect(
      themeSourceRegistrySchema.safeParse({
        ...fictionalRegistry,
        entries: [
          {
            ...fictionalRegistry.entries[0],
            origins: [
              {
                origin: 'https://archive.example.test',
                paths: [{ kind: 'exact', path: '/index?view=1' }],
              },
            ],
          },
        ],
      }).success
    ).toBe(false);
  });

  it('canonicalizes set ordering and resolves only exact allowed HTTPS paths', () => {
    const canonical = canonicalizeThemeSourceRegistry(fictionalRegistry);
    expect(canonical.entries[0].origins[0].paths[0].path).toBe('/index');
    expect(
      resolveThemeSourceUrl(canonical, 'https://archive.example.test/records/one')
    ).toMatchObject({ status: 'matched', entry: { id: 'fictional-archive' } });
    expect(resolveThemeSourceUrl(canonical, 'https://archive.example.test/records')).toEqual({
      status: 'not_allowed',
    });
    expect(resolveThemeSourceUrl(canonical, 'https://archive.example.test/index?x=1')).toEqual({
      status: 'invalid_url',
    });
    expect(resolveThemeSourceUrl(null, 'https://archive.example.test/index')).toEqual({
      status: 'missing',
    });
    expect(resolveThemeSourceUrl(canonical, 'https://evil-archive.example.test/index')).toEqual({
      status: 'not_allowed',
    });
    expect(resolveThemeSourceUrl(canonical, 'https://user@archive.example.test/index')).toEqual({
      status: 'invalid_url',
    });
    expect(resolveThemeSourceUrl(canonical, 'http://archive.example.test/index')).toEqual({
      status: 'invalid_url',
    });
    expect(resolveThemeSourceUrl(canonical, 'https://archive.example.test/index#section')).toEqual({
      status: 'invalid_url',
    });
    expect(resolveThemeSourceUrl(canonical, 'https://archive.example.test/records-other')).toEqual({
      status: 'not_allowed',
    });
    expect(resolveThemeSourceUrl(canonical, 'https://archive.example.test/%2e%2e/index')).toEqual({
      status: 'invalid_url',
    });
    expect(resolveThemeSourceUrl(canonical, 'https://archive.example.test/\nindex')).toEqual({
      status: 'invalid_url',
    });
  });

  it('supports a broad secondary reference without per-theme curation', () => {
    const broadReference: ThemeSourceRegistry = {
      contractVersion: 'theme-source-registry-v1',
      sourcePolicyVersion: 'broad-reference-1',
      entries: [
        {
          id: 'wikipedia-en',
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
    };
    expect(themeSourceRegistrySchema.safeParse(broadReference).success).toBe(true);
    expect(
      resolveThemeSourceUrl(broadReference, 'https://en.wikipedia.org/wiki/Trivia')
    ).toMatchObject({ status: 'matched', entry: { id: 'wikipedia-en' } });
    expect(
      resolveThemeSourceUrl(broadReference, 'https://en.wikipedia.org/wiki/Montr%C3%A9al')
    ).toMatchObject({ status: 'matched', entry: { id: 'wikipedia-en' } });
  });
});
