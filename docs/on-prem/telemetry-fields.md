# Telemetry — per-field data-minimization justification

<!-- glossary:block id=telemetry-fields-telemetry-per-field-data-minimization-justificatio-paragraph-1 -->
This document enumerates every field the on-prem telemetry uploader
sends to the Aster SaaS ingest endpoint, alongside the rationale for
collecting it. It is the audit-trail for **GDPR Art 5(1)(c)** ("data
minimization") and **Art 30** (records of processing activities).
<!-- /glossary:block -->

<!-- glossary:block id=telemetry-fields-telemetry-per-field-data-minimization-justificatio-paragraph-2 -->
The wire contract is defined in code at
`src/lib/telemetry/schema-contract.ts` — any new field must amend both
that module **and** this document in the same PR.
<!-- /glossary:block -->

<!-- glossary:block id=telemetry-fields-telemetry-per-field-data-minimization-justificatio-paragraph-3 -->
The contract is also served publicly at `/api/v1/telemetry/schema`;
machine-readable consumers should read from there rather than scraping
this Markdown file.
<!-- /glossary:block -->

---

## Schema v1 — current

<!-- glossary:block id=telemetry-fields-schema-v1-current-paragraph-4 -->
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
<!-- /glossary:block -->

---

## What we deliberately do NOT collect

<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-5 -->
- **User identifiers** — no userId, email, IP, agent string.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-6 -->
- **Tenant / org names** — `customer` header is the legal entity name
  from the license; can be masked to `anon-<hex>-<len>` via
  `ASTER_TELEMETRY_MASK_CUSTOMER=1` (see telemetry.md).
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-7 -->
- **Policy content** — only counts, never policy bodies, names, or
  rule strings.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-8 -->
- **Execution outcomes** — only the aggregate count, never which
  policy ran or what it decided.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-9 -->
- **Stack traces / errors** — telemetry is success-path only; errors
  go to ops via Slack alerts, never to SaaS.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-10 -->
- **Geolocation** — handled SaaS-side via `dataRegion` stamping (see
  J2/J3 records of processing).
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-11 -->
- **Performance metrics** — latency, memory, CPU not in scope.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-list-item-12 -->
- **Browser telemetry** — opt-in is server-side; the browser is not
  involved.
<!-- /glossary:block -->

<!-- glossary:block id=telemetry-fields-what-we-deliberately-do-not-collect-paragraph-13 -->
A field is included **only if** removing it would prevent Aster from
delivering a contracted service (billing, license verification,
capacity-based account management). The "legitimate interest"
fields are individually justifiable as proportionate; the schema would
not pass a DPIA without that proportionality test.
<!-- /glossary:block -->

---

## How to add a new field

<!-- glossary:block id=telemetry-fields-how-to-add-a-new-field-list-item-14 -->
1. Edit `src/lib/telemetry/schema-contract.ts`:
   - Append the field to `TELEMETRY_FIELDS_V1` with `necessity` + `since`.
   - If the field is required for new uploads, bump
     `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS` to add v2 alongside v1, and
     add a `TELEMETRY_FIELDS_V2` constant.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-how-to-add-a-new-field-list-item-15 -->
2. Edit this document — add a row to the table for the version it's
   in. Use clear customer-readable English; this doc is what shows up
   in a DPA review.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-how-to-add-a-new-field-list-item-16 -->
3. Edit `src/lib/telemetry/payload-builder.ts` to compute the field.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-how-to-add-a-new-field-list-item-17 -->
4. Add ingest-side validation in `src/app/api/v1/telemetry/route.ts`
   gated on `schemaVersion`. Reject old uploads only after the
   deprecation window from the next bullet.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-how-to-add-a-new-field-list-item-18 -->
5. Communicate. New schema versions ship with a 90-day overlap window
   (both versions accepted) so on-prem deployments have time to
   upgrade. Drop the old version from `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS`
   only after notice + telemetry shows < 5% of deployments still on it.
<!-- /glossary:block -->

<!-- glossary:block id=telemetry-fields-how-to-add-a-new-field-paragraph-19 -->
If the new field is anything other than an aggregate integer or
boolean, the field needs a privacy review (`#privacy-review` Slack or
DPO email) before merge.
<!-- /glossary:block -->

---

## How to remove a field

<!-- glossary:block id=telemetry-fields-how-to-remove-a-field-list-item-20 -->
1. Bump `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS` to introduce the new
   version *without* the field.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-how-to-remove-a-field-list-item-21 -->
2. Keep accepting the old version for 90 days.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-how-to-remove-a-field-list-item-22 -->
3. Drop the field from `TELEMETRY_FIELDS_V<old>` only after the old
   version is no longer in `SUPPORTED_TELEMETRY_SCHEMA_VERSIONS`.
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-how-to-remove-a-field-list-item-23 -->
4. Run a one-shot DSAR-friendly migration to drop the field from
   `LicenseTelemetry.payload` historical rows if the data is no longer
   needed for billing audit (otherwise rely on the 365-day retention GC
   in J1 to age it out).
<!-- /glossary:block -->

---

## Related documents

<!-- glossary:block id=telemetry-fields-related-documents-list-item-24 -->
- Threat model + opt-in / opt-out flow: `docs/on-prem/telemetry.md`
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-related-documents-list-item-25 -->
- DPA template (Art 28 controller / processor agreement):
  `docs/on-prem/dpa-template.md`
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-related-documents-list-item-26 -->
- Retention + DSAR delete: `src/lib/telemetry/access-audit.ts`
  (cron: `/api/cron/telemetry-retention-gc`)
<!-- /glossary:block -->
<!-- glossary:block id=telemetry-fields-related-documents-list-item-27 -->
- At-rest encryption of HMAC verification secrets:
  `docs/saas/kek-rotation.md` (SaaS ops only)
<!-- /glossary:block -->
