# Data Processing Agreement (DPA) Template — Aster Telemetry

> **Status**: Template. Negotiate with sales for executed copy.
> **Last reviewed**: 2026-05
> **Effective scope**: opt-in telemetry uploaded to Aster SaaS via
> `/api/v1/telemetry`.

This template covers the GDPR Art 28 controller-processor relationship
when a customer enables the opt-in telemetry uploader
(`ASTER_TELEMETRY_OPT_IN=1`). For the license-key cryptographic
material itself, no DPA is needed because no personal data is exchanged
beyond what the license payload itself encodes (customer name + license
ID, which are contractual fields).

---

## 1. Parties

- **Controller**: `<Customer legal entity name>`, address `<...>`.
  Represents the customer's on-prem deployment of aster-cloud.
- **Processor**: Aster Cloud Inc., address `<...>`.
  Operates the SaaS ingest endpoint + storage.

## 2. Subject Matter

Aster processes opt-in aggregate usage telemetry uploaded by the
customer's on-prem deployment. The payload schema is enumerated in
[`telemetry.md`](./telemetry.md). All fields are integer counters or
booleans; no event content, no user identifiers, no PII.

## 3. Duration

This DPA enters into force on `<effective date>` and remains in effect
for so long as the customer has `ASTER_TELEMETRY_OPT_IN=1` configured
in their deployment, plus the retention period for stored data (see
§7).

## 4. Nature and Purpose of Processing

| Activity | Purpose |
|----------|---------|
| Receiving telemetry uploads via HTTPS | Aggregate usage observability for renewal review |
| Storing in SaaS PostgreSQL | Retain for §7 retention period |
| Per-license dedup by period window | Idempotent producers, GDPR Art 5(1)(c) data minimization |
| Admin read on `/admin/issued-licenses` | Sales/renewal conversation context |
| Retention GC via nightly cron | GDPR Art 5(1)(e) storage limitation |
| DSAR-driven delete via authenticated admin endpoint | GDPR Art 17 right to erasure |
| Access audit on TelemetryAccessAudit table | SOC 2 CC6.1 / ISO 27001 A.12.4.1 |

## 5. Types of Personal Data

When `ASTER_TELEMETRY_MASK_CUSTOMER` is **unset or != "1"** (default):

| Field | Source | Personal data? |
|-------|--------|----------------|
| `customer` | License payload, set at sign time | Potentially — if customer is a small entity matching an identifiable person |
| `licenseId` | License payload | No, contractual identifier |
| `deploymentId` | sha256(customer\|slug), license payload | No, opaque hash |
| `sourceIp` | Server-recorded at ingest | Yes, IP address |
| All payload counters | Aggregate, not per-user | No |
| `appVersion` (if `ASTER_BUILD_SHA` set) | Server env | No |

When `ASTER_TELEMETRY_MASK_CUSTOMER=1`:

| Field | Replaced by | Personal data? |
|-------|-------------|----------------|
| `customer` | `anon-<sha256-prefix>-<len>` | No |
| All other fields | (unchanged) | (as above) |

**Recommendation**: enable `ASTER_TELEMETRY_MASK_CUSTOMER=1` if your
organization is unwilling to designate `customer` as processed personal
data.

## 6. Categories of Data Subjects

- The customer's employees and contractors (if any of their counts
  derive from individuated rows like `activeSeats` — note the count
  itself is aggregate, no individual ever leaves the deployment).

## 7. Retention

| Data | Default retention |
|------|-------------------|
| `LicenseTelemetry` rows | 365 days rolling |
| `TelemetryAccessAudit` reads | 90 days |
| `TelemetryAccessAudit` deletes | 7 years (legal hold) |

Implemented by nightly cron `POST /api/cron/telemetry-retention-gc`.
Retention windows can be shortened (not extended) via env override for
incident response; the DPA addendum lists any in-force overrides.

## 8. Sub-Processors

Aster currently uses:

- `<Cloud provider, e.g. Cloudflare>` for the ingest endpoint edge.
- `<Cloud provider, e.g. AWS/GCP/Azure>` for SaaS PostgreSQL.
- `<Email provider, e.g. Resend>` for renewal notifications (does not
  process telemetry data, listed here for completeness).

Adding sub-processors is communicated 30 days in advance; controller
may object per §11.

## 9. International Transfers

Aster runs SaaS in `<region>` (see `data_region` column on every row +
the privacy page at `/<locale>/privacy`). Customers in restricted
regions (EU/EEA, UK, Switzerland) consume the SCC (Standard Contractual
Clauses, 2021/914) Module 2 (controller to processor) appended as
Annex B to this DPA. Customers requiring data localization can purchase
the regional add-on (see sales).

## 10. Security Measures

- **In transit**: TLS 1.3 from on-prem to SaaS ingest; HMAC-SHA256
  signature on every payload with a per-license secret.
- **At rest**: PostgreSQL with provider-managed encryption (AES-256).
  HMAC verification secrets are additionally envelope-encrypted with
  AES-256-GCM under a Key Encryption Key held in Vault; DB-only
  compromise does not yield usable secrets. Rotation runbook is
  internal (`docs/saas/kek-rotation.md`).
- **Access**: SaaS admin sessions only; every read of
  `LicenseTelemetry` is audited per §4.
- **Network**: SaaS ingest behind Cloudflare WAF with rate-limit rules
  on the telemetry endpoint.
- **Personnel**: Aster employees with prod data access sign confidentiality
  agreements and complete annual privacy training.

## 11. Controller Rights

Controller may, by giving Aster `<N>` days written notice:

- Audit Aster's compliance with this DPA (SOC 2 Type II report annually
  satisfies; on-site audit available at controller's cost).
- Object to a proposed sub-processor (Aster responds with mitigation or
  termination option).
- Issue a data subject request — Aster fulfills within GDPR Art 12(3) 1-month
  window via the DSAR delete endpoint.

## 12. Data Breach Notification

In the event of a data breach affecting telemetry data, Aster will
notify controller without undue delay and in any event within 72 hours
of becoming aware, providing:

- Nature of the breach, categories and approximate number of records
  affected.
- Name and contact of Aster's Data Protection Officer.
- Likely consequences.
- Mitigation taken and planned.

## 13. Return / Deletion on Termination

Within 30 days of termination of this DPA (either by ending
`ASTER_TELEMETRY_OPT_IN=1` and notifying sales, or by ending the
underlying contract), Aster deletes all of controller's telemetry data
via the DSAR delete endpoint, retaining only the
`TelemetryAccessAudit` deletion records under legal hold (§7).

---

## How to execute

1. Sales sends customer this template with parties + dates filled in.
2. Controller redlines as needed.
3. Both parties sign (electronic signatures acceptable per
   `<jurisdiction>`).
4. Customer keeps a copy; Aster stores executed copy in legal vault
   (not in the SaaS app).

## Related documents

- [`telemetry.md`](./telemetry.md) — what data is sent + privacy notice
- [`license-management.md`](./license-management.md) — license lifecycle
- Privacy notice page (live): `<saas-host>/<locale>/privacy`
