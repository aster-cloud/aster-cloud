/**
 * Shared constants for the /domain-vocabularies surface. Lives next to
 * the route so both the list view and the dialog reference the same set.
 */

export const KIND_OPTIONS = ['struct', 'field', 'function', 'enum_value'] as const;
export type Kind = (typeof KIND_OPTIONS)[number];

export const KNOWN_ERROR_CODES = new Set([
  'quota_exceeded',
  'duplicate_link',
  'validation_failed',
  'not_found',
  'plan_gate_required',
  'internal_error',
]);
