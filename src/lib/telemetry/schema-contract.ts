// Telemetry schema-version contract — single source of truth for both
// producer (on-prem cron) and consumer (SaaS ingest).
//
// Why a contract module rather than just a magic-number check at ingest:
//   - Ops needs a machine-readable answer to "what versions does SaaS
//     currently accept?" so on-prem deployments can fail loudly rather
//     than silently when ingestion shifts under them.
//   - GDPR Art 5(1)(c) data minimization: every field on the wire
//     should have a justification. Putting the field list in code (not
//     just docs) means a refactor that adds a field has to amend the
//     contract — review-gate that's easier to enforce than a doc-only
//     promise.
//   - The /api/v1/telemetry/schema discovery endpoint serializes this
//     contract verbatim so customers can audit "did the SaaS just
//     change what it accepts without telling me?"
//
// This module is import-safe from both on-prem and SaaS bundles. No
// secrets, no DB, no network. Both sides depend on the exact same
// constant so any drift is impossible by construction.

/** Schema versions SaaS ingest currently accepts. Ordered oldest→newest. */
export const SUPPORTED_TELEMETRY_SCHEMA_VERSIONS = [1] as const;

export type SupportedTelemetrySchemaVersion =
  (typeof SUPPORTED_TELEMETRY_SCHEMA_VERSIONS)[number];

/** Lowest version currently accepted (clients below this should refuse). */
export const MIN_TELEMETRY_SCHEMA_VERSION = Math.min(
  ...SUPPORTED_TELEMETRY_SCHEMA_VERSIONS,
);

/** Newest version currently accepted (informational for clients). */
export const MAX_TELEMETRY_SCHEMA_VERSION = Math.max(
  ...SUPPORTED_TELEMETRY_SCHEMA_VERSIONS,
);

export function isSupportedSchemaVersion(v: unknown): v is SupportedTelemetrySchemaVersion {
  return (
    typeof v === 'number' &&
    (SUPPORTED_TELEMETRY_SCHEMA_VERSIONS as readonly number[]).includes(v)
  );
}

/**
 * Field-level data-minimization justification — same fields the
 * payload-builder emits, annotated with the legal basis under which
 * each is collected. Mirrors docs/on-prem/telemetry-fields.md so the
 * doc and the code stay in sync (doc generation could derive from here
 * later; for now we cross-reference manually in PR review).
 */
export interface TelemetryFieldJustification {
  /** Property name on the wire. */
  name: string;
  /** Wire type. */
  type: 'number' | 'boolean' | 'string' | 'string[]' | 'iso-datetime';
  /** Required or optional in the schema version. */
  required: boolean;
  /** Plain-language description of what the value represents. */
  purpose: string;
  /** GDPR Art 5(1)(c) "necessity" rationale — why this field is required, not nice-to-have. */
  necessity: string;
  /** Schema version this field was introduced in. */
  since: SupportedTelemetrySchemaVersion;
}

export const TELEMETRY_FIELDS_V1: ReadonlyArray<TelemetryFieldJustification> = [
  {
    name: 'schemaVersion',
    type: 'number',
    required: true,
    purpose: 'Wire format version.',
    necessity: 'Required for version negotiation; rejecting unknown versions prevents accidental data drift.',
    since: 1,
  },
  {
    name: 'periodStart',
    type: 'iso-datetime',
    required: true,
    purpose: 'Inclusive lower bound of the aggregation window.',
    necessity: 'Required for dedup key (license_id, period_start, period_end); without it SaaS cannot distinguish duplicates from a new window.',
    since: 1,
  },
  {
    name: 'periodEnd',
    type: 'iso-datetime',
    required: true,
    purpose: 'Exclusive upper bound of the aggregation window.',
    necessity: 'See periodStart — second half of the dedup key.',
    since: 1,
  },
  {
    name: 'activeSeats',
    type: 'number',
    required: true,
    purpose: 'Count of distinct users with at least one login event during the window.',
    necessity: 'Renewal capacity planning — pure integer, no user identifiers. Sales / customer success use this to flag undersized SKUs before customer hits a wall.',
    since: 1,
  },
  {
    name: 'policiesActive',
    type: 'number',
    required: true,
    purpose: 'Count of policies marked active in the deployment.',
    necessity: 'Capacity planning + abuse detection (a 10-policy deployment suddenly reporting 10k may be misconfigured).',
    since: 1,
  },
  {
    name: 'policyExecutionsCount',
    type: 'number',
    required: true,
    purpose: 'Total policy executions in the window across all tenants.',
    necessity: 'Engagement signal — distinguishes deployments-in-production from deployments-in-evaluation, drives the deprecation timeline for features that go unused.',
    since: 1,
  },
  {
    name: 'totalProvisionedSeats',
    type: 'number',
    required: true,
    purpose: 'Total user rows currently provisioned (independent of recent activity).',
    necessity: 'Required to evaluate seat-limit pressure; activeSeats alone undercounts deployments where most users log in monthly.',
    since: 1,
  },
  {
    name: 'seatLimitHit',
    type: 'boolean',
    required: true,
    purpose: 'Whether the deployment touched its licensed seat limit at any point.',
    necessity: 'Single bit; allows SaaS to surface "you are constrained" without inspecting raw user data.',
    since: 1,
  },
  {
    name: 'featuresUsed',
    type: 'string[]',
    required: true,
    purpose: 'Sorted list of license-declared feature flags that the deployment exercised in the window.',
    necessity: 'License-declared feature names only — no per-user feature linkage. Matches the contractually agreed feature set; cannot leak feature usage that was never licensed.',
    since: 1,
  },
  {
    name: 'appVersion',
    type: 'string',
    required: false,
    purpose: 'Aster build SHA the deployment is running.',
    necessity: 'Optional. Correlates upgrade adoption rate; helps prioritize bug-fix backports. No PII.',
    since: 1,
  },
  {
    name: 'nodeVersion',
    type: 'string',
    required: false,
    purpose: 'Node.js major version (e.g. "20.x").',
    necessity: 'Optional. Drives Node EOL communication. No PII.',
    since: 1,
  },
];

export const TELEMETRY_CONTRACT_BY_VERSION: Readonly<
  Record<SupportedTelemetrySchemaVersion, ReadonlyArray<TelemetryFieldJustification>>
> = {
  1: TELEMETRY_FIELDS_V1,
};
