import { describe, expect, it } from 'vitest';
import { routeParam } from './route-param';

describe('routeParam', () => {
  it('returns a string param unchanged', () => {
    expect(routeParam('abc-123', 'id')).toBe('abc-123');
  });

  it('rejects array and missing values', () => {
    expect(() => routeParam(['a', 'b'], 'id')).toThrow('"id"');
    expect(() => routeParam(undefined, 'id')).toThrow(TypeError);
  });
});
