import { describe, expect, it } from 'vitest';

import {
  canonicalizeThemeSourceRegistry,
  type ThemeSourceRegistry,
} from '@shared/models/theme-source-registry';

import { hashThemeSourceRegistry } from './theme-source-registry';

const manifest: ThemeSourceRegistry = {
  contractVersion: 'theme-source-registry-v1',
  sourcePolicyVersion: 'fictional-policy-1',
  entries: [
    {
      id: 'source-1',
      publisherId: 'fictional-publisher',
      publisherName: 'Fictional Publisher',
      originGroup: 'fictional-group',
      sourceClass: 'primary_record',
      scope: {
        topics: ['Zoology', 'Botany'],
        languages: ['fr', 'en'],
        geographies: ['Fictional North'],
        temporal: { from: '1900-01-01', through: '2100-12-31' },
      },
      origins: [
        {
          origin: 'https://fictional.example.test',
          paths: [
            { kind: 'exact', path: '/z' },
            { kind: 'exact', path: '/a' },
          ],
        },
      ],
    },
  ],
};

describe('source registry hashing', () => {
  it('ignores set order but changes for content changes', () => {
    const canonical = canonicalizeThemeSourceRegistry(manifest);
    expect(hashThemeSourceRegistry(manifest)).toBe(hashThemeSourceRegistry(canonical));
    expect(
      hashThemeSourceRegistry({ ...manifest, sourcePolicyVersion: 'fictional-policy-2' })
    ).not.toBe(hashThemeSourceRegistry(manifest));
  });
});
