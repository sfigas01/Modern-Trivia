import { describe, expect, it } from 'vitest';

import { deriveCanonicalThemeFactKey, normalizeThemeFactScope } from './theme-proposal-slots';

const scope = {
  entity: ' World   Baseball Classic ',
  relation: ' Final venue ',
  time: ' 2006 ',
  geography: ' United States ',
  competitionOrDomain: ' Baseball ',
  qualifiers: [' Championship ', 'international', 'championship'],
  asOf: '2026-11-01T00:00:00Z',
};

describe('theme proposal slot fact identity', () => {
  it('normalizes the complete scope deterministically', () => {
    expect(normalizeThemeFactScope(scope)).toEqual({
      entity: 'world baseball classic',
      relation: 'final venue',
      time: '2006',
      geography: 'united states',
      competitionOrDomain: 'baseball',
      qualifiers: ['championship', 'international'],
      asOf: '2026-11-01T00:00:00.000Z',
    });
    expect(deriveCanonicalThemeFactKey(scope)).toBe(
      deriveCanonicalThemeFactKey({
        ...scope,
        entity: 'world baseball classic',
        qualifiers: ['international', 'Championship'],
        asOf: '2026-11-01T00:00:00.000Z',
      })
    );
  });

  it('changes identity when a meaningful scope dimension changes', () => {
    const original = deriveCanonicalThemeFactKey(scope);
    expect(deriveCanonicalThemeFactKey({ ...scope, time: '2009' })).not.toBe(original);
    expect(deriveCanonicalThemeFactKey({ ...scope, geography: null })).not.toBe(original);
    expect(deriveCanonicalThemeFactKey({ ...scope, asOf: null })).not.toBe(original);
  });
});
