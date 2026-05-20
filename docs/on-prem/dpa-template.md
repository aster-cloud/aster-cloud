# Data Processing Agreement (DPA) Template — Aster Telemetry

<!-- glossary:block id=dpa-template-data-processing-agreement-dpa-template-aster-telem-blockquote-1 -->
> **Status**: Template. Negotiate with sales for executed copy.
> **Last reviewed**: 2026-05
> **Effective scope**: opt-in telemetry uploaded to Aster SaaS via
> `/api/v1/telemetry`.
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-data-processing-agreement-dpa-template-aster-telem-paragraph-2 -->
This template covers the GDPR Art 28 controller-processor relationship
when a customer enables the opt-in telemetry uploader
(`ASTER_TELEMETRY_OPT_IN=1`). For the license-key cryptographic
material itself, no DPA is needed because no personal data is exchanged
beyond what the license payload itself encodes (customer name + license
ID, which are contractual fields).
<!-- /glossary:block -->

---

## 1. Parties

<!-- glossary:block id=dpa-template-1-parties-list-item-3 -->
- **Controller**: `<Customer legal entity name>`, address `<...>`.
  Represents the customer's on-prem deployment of aster-cloud.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-1-parties-list-item-4 -->
- **Processor**: Aster Cloud Inc., address `<...>`.
  Operates the SaaS ingest endpoint + storage.
<!-- /glossary:block -->

## 2. Subject Matter

<!-- glossary:block id=dpa-template-2-subject-matter-paragraph-5 -->
Aster processes opt-in aggregate usage telemetry uploaded by the
customer's on-prem deployment. The payload schema is enumerated in
[`telemetry.md`](./telemetry.md). All fields are integer counters or
booleans; no event content, no user identifiers, no PII.
<!-- /glossary:block -->

## 3. Duration

<!-- glossary:block id=dpa-template-3-duration-paragraph-6 -->
This DPA enters into force on `<effective date>` and remains in effect
for so long as the customer has `ASTER_TELEMETRY_OPT_IN=1` configured
in their deployment, plus the retention period for stored data (see
§7).
<!-- /glossary:block -->

## 4. Nature and Purpose of Processing

<!-- glossary:block id=dpa-template-4-nature-and-purpose-of-processing-paragraph-7 -->
| Activity | Purpose |
|----------|---------|
| Receiving telemetry uploads via HTTPS | Aggregate usage observability for renewal review |
| Storing in SaaS PostgreSQL | Retain for §7 retention period |
| Per-license dedup by period window | Idempotent producers, GDPR Art 5(1)(c) data minimization |
| Admin read on `/admin/issued-licenses` | Sales/renewal conversation context |
| Retention GC via nightly cron | GDPR Art 5(1)(e) storage limitation |
| DSAR-driven delete via authenticated admin endpoint | GDPR Art 17 right to erasure |
| Access audit on TelemetryAccessAudit table | SOC 2 CC6.1 / ISO 27001 A.12.4.1 |
<!-- /glossary:block -->

## 5. Types of Personal Data

<!-- glossary:block id=dpa-template-5-types-of-personal-data-paragraph-8 -->
The complete per-field justification (GDPR Art 5(1)(c) data
minimization evidence) is documented in
[`docs/on-prem/telemetry-fields.md`](./telemetry-fields.md). The
machine-readable schema contract is served at
`/api/v1/telemetry/schema`. Summary below.
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-5-types-of-personal-data-paragraph-9 -->
When `ASTER_TELEMETRY_MASK_CUSTOMER` is **unset or != "1"** (default):
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-5-types-of-personal-data-paragraph-10 -->
| Field | Source | Personal data? |
|-------|--------|----------------|
| `customer` | License payload, set at sign time | Potentially — if customer is a small entity matching an identifiable person |
| `licenseId` | License payload | No, contractual identifier |
| `deploymentId` | sha256(customer\|slug), license payload | No, opaque hash |
| `sourceIp` | Server-recorded at ingest | Yes, IP address |
| All payload counters | Aggregate, not per-user | No |
| `appVersion` (if `ASTER_BUILD_SHA` set) | Server env | No |
<!-- /glossary:block -->

When `ASTER_TELEMETRY_MASK_CUSTOMER=1`:

<!-- glossary:block id=dpa-template-5-types-of-personal-data-paragraph-11 -->
| Field | Replaced by | Personal data? |
|-------|-------------|----------------|
| `customer` | `anon-<sha256-prefix>-<len>` | No |
| All other fields | (unchanged) | (as above) |
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-5-types-of-personal-data-paragraph-12 -->
**Recommendation**: enable `ASTER_TELEMETRY_MASK_CUSTOMER=1` if your
organization is unwilling to designate `customer` as processed personal
data.
<!-- /glossary:block -->

## 6. Categories of Data Subjects

<!-- glossary:block id=dpa-template-6-categories-of-data-subjects-list-item-13 -->
- The customer's employees and contractors (if any of their counts
  derive from individuated rows like `activeSeats` — note the count
  itself is aggregate, no individual ever leaves the deployment).
<!-- /glossary:block -->

## 7. Retention

<!-- glossary:block id=dpa-template-7-retention-paragraph-14 -->
| Data | Default retention |
|------|-------------------|
| `LicenseTelemetry` rows | 365 days rolling |
| `TelemetryAccessAudit` reads | 90 days |
| `TelemetryAccessAudit` deletes | 7 years (legal hold) |
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-7-retention-paragraph-15 -->
Implemented by nightly cron `POST /api/cron/telemetry-retention-gc`.
Retention windows can be shortened (not extended) via env override for
incident response; the DPA addendum lists any in-force overrides.
<!-- /glossary:block -->

## 8. Sub-Processors

Aster currently uses:

<!-- glossary:block id=dpa-template-8-sub-processors-list-item-16 -->
- `<Cloud provider, e.g. Cloudflare>` for the ingest endpoint edge.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-8-sub-processors-list-item-17 -->
- `<Cloud provider, e.g. AWS/GCP/Azure>` for SaaS PostgreSQL.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-8-sub-processors-list-item-18 -->
- `<Email provider, e.g. Resend>` for renewal notifications (does not
  process telemetry data, listed here for completeness).
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-8-sub-processors-paragraph-19 -->
Adding sub-processors is communicated 30 days in advance; controller
may object per §11.
<!-- /glossary:block -->

## 9. International Transfers

<!-- glossary:block id=dpa-template-9-international-transfers-paragraph-20 -->
Aster runs SaaS in `<region>` (see `data_region` column on every row +
the privacy page at `/<locale>/privacy`). Customers in restricted
regions (EU/EEA, UK, Switzerland) consume the SCC (Standard Contractual
Clauses, 2021/914) Module 2 (controller to processor) appended as
Annex B to this DPA. Customers requiring data localization can purchase
the regional add-on (see sales).
<!-- /glossary:block -->

## 10. Security Measures

<!-- glossary:block id=dpa-template-10-security-measures-list-item-21 -->
- **In transit**: TLS 1.3 from on-prem to SaaS ingest; HMAC-SHA256
  signature on every payload with a per-license secret.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-10-security-measures-list-item-22 -->
- **At rest**: PostgreSQL with provider-managed encryption (AES-256).
  HMAC verification secrets are additionally envelope-encrypted with
  AES-256-GCM under a Key Encryption Key held in Vault; DB-only
  compromise does not yield usable secrets. Rotation runbook is
  internal (`docs/saas/kek-rotation.md`).
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-10-security-measures-list-item-23 -->
- **Access**: SaaS admin sessions only; every read of
  `LicenseTelemetry` is audited per §4.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-10-security-measures-list-item-24 -->
- **Network**: SaaS ingest behind Cloudflare WAF with rate-limit rules
  on the telemetry endpoint.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-10-security-measures-list-item-25 -->
- **Personnel**: Aster employees with prod data access sign confidentiality
  agreements and complete annual privacy training.
<!-- /glossary:block -->

## 11. Controller Rights

<!-- glossary:block id=dpa-template-11-controller-rights-paragraph-26 -->
Controller may, by giving Aster `<N>` days written notice:
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-11-controller-rights-list-item-27 -->
- Audit Aster's compliance with this DPA (SOC 2 Type II report annually
  satisfies; on-site audit available at controller's cost).
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-11-controller-rights-list-item-28 -->
- Object to a proposed sub-processor (Aster responds with mitigation or
  termination option).
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-11-controller-rights-list-item-29 -->
- Issue a data subject request — Aster fulfills within GDPR Art 12(3) 1-month
  window. Two equivalent paths:
  - **Self-service**: controller signs a POST to `/api/v1/dsar` with the
    per-license HMAC secret; supports `dryRun=true` preview. See
    `docs/on-prem/dsar.md`.
  - **Operator-assisted**: email `dpo@aster-lang.cloud` and Aster ops
    runs the admin DSAR endpoint on controller's behalf.
<!-- /glossary:block -->

## 12. Data Breach Notification

<!-- glossary:block id=dpa-template-12-data-breach-notification-paragraph-30 -->
In the event of a data breach affecting telemetry data, Aster will
notify controller without undue delay and in any event within 72 hours
of becoming aware, providing:
<!-- /glossary:block -->

<!-- glossary:block id=dpa-template-12-data-breach-notification-list-item-31 -->
- Nature of the breach, categories and approximate number of records
  affected.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-12-data-breach-notification-list-item-32 -->
- Name and contact of Aster's Data Protection Officer.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-12-data-breach-notification-list-item-33 -->
- Likely consequences.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-12-data-breach-notification-list-item-34 -->
- Mitigation taken and planned.
<!-- /glossary:block -->

## 13. Return / Deletion on Termination

<!-- glossary:block id=dpa-template-13-return-deletion-on-termination-paragraph-35 -->
Within 30 days of termination of this DPA (either by ending
`ASTER_TELEMETRY_OPT_IN=1` and notifying sales, or by ending the
underlying contract), Aster deletes all of controller's telemetry data
via the DSAR delete endpoint, retaining only the
`TelemetryAccessAudit` deletion records under legal hold (§7).
<!-- /glossary:block -->

---

## How to execute

<!-- glossary:block id=dpa-template-how-to-execute-list-item-36 -->
1. Sales sends customer this template with parties + dates filled in.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-how-to-execute-list-item-37 -->
2. Controller redlines as needed.
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-how-to-execute-list-item-38 -->
3. Both parties sign (electronic signatures acceptable per
   `<jurisdiction>`).
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-how-to-execute-list-item-39 -->
4. Customer keeps a copy; Aster stores executed copy in legal vault
   (not in the SaaS app).
<!-- /glossary:block -->

## Related documents

<!-- glossary:block id=dpa-template-related-documents-list-item-40 -->
- [`telemetry.md`](./telemetry.md) — what data is sent + privacy notice
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-related-documents-list-item-41 -->
- [`license-management.md`](./license-management.md) — license lifecycle
<!-- /glossary:block -->
<!-- glossary:block id=dpa-template-related-documents-list-item-42 -->
- Privacy notice page (live): `<saas-host>/<locale>/privacy`
<!-- /glossary:block -->
