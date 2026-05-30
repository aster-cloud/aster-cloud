/**
 * SQL escape helpers shared across service modules.
 *
 * Drizzle parameterizes input values, but it doesn't know about LIKE
 * semantics — that's our job. Centralizing the rule means a future
 * caller (admin search, team-list filter) can't accidentally drop the
 * escape and ship a user with `_` in their email a 99% match rate.
 */

/**
 * Escape the three LIKE wildcards so a user typing `%` or `_` doesn't
 * accidentally match everything. Apply BEFORE wrapping in `%...%`.
 *
 * Example:
 *   const pattern = `%${escapeLikePattern(input)}%`;
 *   sql`${column} ILIKE ${pattern}`
 */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/([\\%_])/g, '\\$1');
}
