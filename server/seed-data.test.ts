import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

import { VALID_CATEGORIES, CATEGORY_SET } from '../shared/constants/categories';

const seedData = JSON.parse(
  readFileSync(join(__dirname, 'seed-data.json'), 'utf-8')
) as { category?: unknown }[];

describe('seed-data.json category integrity', () => {
  it('has no questions with a missing category', () => {
    const missing = seedData.filter((q) => !q.category);
    expect(missing).toHaveLength(0);
  });

  it('has no questions with a non-canonical category', () => {
    const invalid = seedData.filter(
      (q) => typeof q.category !== 'string' || !CATEGORY_SET.has(q.category)
    );
    if (invalid.length > 0) {
      const badValues = [...new Set(invalid.map((q) => q.category))];
      throw new Error(`Found ${invalid.length} question(s) with invalid categories: ${JSON.stringify(badValues)}`);
    }
    expect(invalid).toHaveLength(0);
  });

  it('uses every canonical category at least once', () => {
    const used = new Set(seedData.map((q) => q.category));
    for (const cat of VALID_CATEGORIES) {
      expect(used.has(cat), `category "${cat}" has no questions in seed data`).toBe(true);
    }
  });

  it('has no legacy category values', () => {
    const legacy = [
      'History', 'Geography', 'Government',
      'Science', 'Nature', 'Space',
      'Entertainment', 'Movies', 'movies', 'Music',
      'Pop Culture', 'pop culture',
      'Food', 'Culture', 'Art', 'art', 'Literature',
      'technology',
      'General Knowledge',
    ];
    const found = seedData.filter(
      (q) => typeof q.category === 'string' && legacy.includes(q.category)
    );
    if (found.length > 0) {
      const badValues = [...new Set(found.map((q) => q.category))];
      throw new Error(`Legacy categories still present: ${JSON.stringify(badValues)}`);
    }
    expect(found).toHaveLength(0);
  });
});
