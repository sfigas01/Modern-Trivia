/**
 * Narrow a named Express route parameter (e.g. `:id`) to a string.
 *
 * Express 5 types `req.params` values as `string | string[]` because wildcard
 * params (`*splat`) arrive as arrays. Named params are always strings at
 * runtime, so anything else means the route was declared wrong.
 */
export function routeParam(value: string | string[] | undefined, name = 'param'): string {
  if (typeof value !== 'string') {
    throw new TypeError(`Expected route parameter "${name}" to be a string`);
  }
  return value;
}
