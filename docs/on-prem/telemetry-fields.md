# Telemetry — per-field data-minimization justification

This document enumerates every field the on-prem telemetry uploader
sends to the Aster SaaS ingest endpoint, alongside the rationale for
collecting it. It is the audit-trail for **GDPR Art 5(1)(c)** ("data
minimization") and **Art 30** (records of processing activities).

The wire contract is defined in code at
`src/lib/telemetry/schema-contract.ts` — any new field must amend both
that module **and** this document in the same PR.

The contract is also served publicly at `/api/v1/telemetry/schema`;
machine-readable consumers should read from there rather than scraping
this Markdown file.

---

## Schema v1 — current

| Field | Type | Required | Why we collect it | Legal basis |
|-------|------|----------|-------------------|-------------|
| `schemaVersion` | number | yes | Wire format negotiation. SaaS rejects unknown versions, on-prem refuses to send mismatched ones. | Necessary for service operation |
| `periodStart` | ISO-8601 | yes | Inclusive lower bound of the aggregation window. Half of the dedupe key `(license_id, period_start, period_end)`. | Necessary for service operation (preventing duplicate processing) |
| `periodEnd` | ISO-8601 | yes | Exclusive upper bound. Other half of the dedupe key. | Same as above |
| `activeSeats` | integer | yes | Count of distinct users with at least one login in the window. Aster customer-success uses this to identify SKUs that are undersized before the customer hits the seat wall. | Legitimate interest — capacity planning |
| `policiesActive` | integer | yes | Count of policies marked active in the deployment. Capacity / abuse detection signal. | Legitimate interest |
| `policyExecutionsCount` | integer | yes | Total policy executions in the window. Engagement signal — distinguishes production use from evaluation. | Legitimate interest |
| `totalProvisionedSeats` | integer | yes | Total user rows currently provisioned, regardless of recent activity. Required for seat-limit pressure estimation. | Necessary for service operation (billing compliance) |
| `seatLimitHit` | boolean | yes | Single bit: did the deployment touch its seat limit at any point in the window? | Necessary for service operation |
| `featuresUsed` | string[] | yes | Sorted list of **license-declared** feature names exercised during the window. No per-user usage tracking; cannot leak features that were never licensed. | Legitimate interest |
| `appVersion` | string | no | Aster build SHA. Drives bug-fix backport prioritization. | Legitimate interest |
| `nodeVersion` | string | no | Node.js major version. Drives EOL communication. | Legitimate interest |

---

## What we deliberately do NOT collect

- **User identifiers** — no userId, email, IP, agent string.
- **Tenant / org names** — `customer` header is the legal entity name
  from the license; can be masked to `anon-<hex>-<len>` via
  `ASTER_TELEMETRY_MASK_CUSTOMER=1` (see telemetry.md).
- **Policy content** — only counts, never policy bodies, names, or
  rule strings.
- **Execution outcomes** — only the aggregate count, never which
  policy ran or what it decided.
- **Stack traces / errors** — telemetry is success-path only; errors
  go to ops via Slack alerts, never to SaaS.
- **Geolocation** — handled SaaS-side via `dataRegion` stamping (see
  J2/J3 records of processing).
- **Performance metrics** — latency, memory, CPU not in scope.
- **Browser telemetry** — opt-in is server-side; the browser is not
  involved.

A field is included **only if** removing it would prevent Aster from
delivering a contracted service (billing, license verification,
capacity-based account management). The "legitimate interest"
fields are individually justifiable as proportionate; the schema would
not pass a DPIA without that proportionality test.

---

## How to add a new field

1. Edit `src/lib/telemetry/schema-contract.ts`:
   - Append the field to `TELEMETRY_FIELDS_V1` with `necessity` + `since`.
   - If the field is required for new uploads, bump
     `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS` to add v2 alongside v1, and
     add a `TELEMETRY_FIELDS_V2` constant.
2. Edit this document — add a row to the table for the version it's
   in. Use clear customer-readable English; this doc is what shows up
   in a DPA review.
3. Edit `src/lib/telemetry/payload-builder.ts` to compute the field.
4. Add ingest-side validation in `src/app/api/v1/telemetry/route.ts`
   gated on `schemaVersion`. Reject old uploads only after the
   deprecation window from the next bullet.
5. Communicate. New schema versions ship with a 90-day overlap window
   (both versions accepted) so on-prem deployments have time to
   upgrade. Drop the old version from `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS`
   only after notice + telemetry shows < 5% of deployments still on it.

If the new field is anything other than an aggregate integer or
boolean, the field needs a privacy review (`#privacy-review` Slack or
DPO email) before merge.

---

## How to remove a field

1. Bump `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS` to introduce the new
   version *without* the field.
2. Keep accepting the old version for 90 days.
3. Drop the field from `TELEMETRY_FIELDS_V<old>` only after the old
   version is no longer in `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS`.
4. Run a one-shot DSAR-friendly migration to drop the field from
   `LicenseTelemetry.payload` historical rows if the data is no longer
   needed for billing audit (otherwise rely on the 365-day retention GC
   in J1 to age it out).

---

## Related documents

- Threat model + opt-in / opt-out flow: `docs/on-prem/telemetry.md`
- DPA template (Art 28 controller / processor agreement):
  `docs/on-prem/dpa-template.md`
- Retention + DSAR delete: `src/lib/telemetry/access-audit.ts`
  (cron: `/api/cron/telemetry-retention-gc`)
- At-rest encryption of HMAC verification secrets:
  `docs/saas/kek-rotation.md` (SaaS ops only)
