# License Usage Telemetry (Opt-in)

Aster ships an **opt-in** telemetry uploader. By default it does
nothing — your on-prem deployment makes zero outbound calls related to
licensing. When you turn it on, a daily cron sends a small aggregate
report to SaaS so that, at renewal time, the conversation is grounded
in actual usage.

This document covers (1) exactly what gets sent, (2) how to enable it,
(3) how to verify it, and (4) how to opt out / delete prior reports.

## What is sent

Every field is an integer count or boolean. **No** user identifiers,
**no** email addresses, **no** policy source, **no** decision-trace
content. Full schema:

```jsonc
{
  "schemaVersion": 1,
  "periodStart": "2026-05-12T00:00:00.000Z",
  "periodEnd":   "2026-05-19T00:00:00.000Z",

  // Aggregate usage
  "activeSeats":           7,        // distinct users with login in window
  "totalProvisionedSeats": 10,       // current user row count
  "policiesActive":        42,
  "policyExecutionsCount": 1234,
  "seatLimitHit":          false,    // hit the license's seat cap?
  "featuresUsed":          ["sso", "audit-export"],  // license-declared features

  // Deployment context (no PII)
  "appVersion": "sha-abc123",        // container image tag if set via ASTER_BUILD_SHA
  "nodeVersion": "24.x"
}
```

Stable canonical JSON (keys sorted recursively) is signed with
HMAC-SHA256 using a secret Aster issued to you at license sign time.

## What is NOT sent

- Tenant names / organization names beyond the `customer` field
  already in the license payload (you negotiated that with sales).
- User emails, names, IDs, IPs.
- Policy source code or names.
- Decision-trace content.
- Logs, errors with stack traces, request bodies.
- Anything from `executions.input` / `executions.output`.

If a future schema version proposes adding a new field, it'll show up
in this doc before it ships, and the producer will emit it only after
the recipient (SaaS) confirms the schema bump.

## How to enable

Set these env vars on your aster-cloud deployment:

```bash
ASTER_TELEMETRY_OPT_IN=1
ASTER_TELEMETRY_ENDPOINT=https://api.aster-lang.cloud/api/v1/telemetry
ASTER_TELEMETRY_SECRET=<32+ char secret given at license sign time>
# Optional — if you ever rotate the secret with sales
ASTER_TELEMETRY_SECRET_KID=default

# RECOMMENDED for GDPR-sensitive deployments: replace literal customer
# name with `anon-<hash>-<len>` token. SaaS still correlates reports
# from the same customer but never stores the legal entity name.
ASTER_TELEMETRY_MASK_CUSTOMER=1
```

Then schedule the cron (daily is plenty):

```bash
# 示例 Kubernetes CronJob 调用方式
curl -fsS -X POST \
  -H "Authorization: Bearer ${CRON_SECRET}" \
  https://your-aster-cloud.example.com/api/cron/telemetry-uploader
```

Failure handling: the cron is idempotent (SaaS dedupes by license_id +
period window), so safe to retry. Transient errors (network /
upstream 5xx) return HTTP 503; fatal errors (wrong secret / schema
mismatch) return HTTP 400. Both are also recorded in the on-prem
admin/license page under "Usage telemetry (opt-in)".

## How to verify what was sent

Open `/admin/license`. The "Usage telemetry (opt-in)" panel shows:

- Whether telemetry is enabled.
- Last attempt timestamp (UTC).
- Outcome (Accepted / Deduped / Failed).
- A collapsible "View payload sent to Aster" with the exact counters.

This is the same JSON that hit the wire — no paraphrasing.

## Opting out

Unset `ASTER_TELEMETRY_OPT_IN` (or set to anything other than `"1"`).
The cron returns 204 immediately without touching the DB or opening
sockets. Existing reports already received by SaaS stay there — see
next section.

## Deleting prior reports

For a GDPR Art 17 / CCPA right-to-delete request:

1. Email `dpo@aster-lang.cloud` with your license ID (or customer name)
   and DSAR reference number.
2. Aster operations runs the
   `POST /api/admin/telemetry/dsar-delete` endpoint:
   - `subject=license` deletes one license's rows
   - `subject=customer` deletes all licenses under one customer
3. A `delete-by-dsar` row lands in `TelemetryAccessAudit` with the
   `dsarRef` so we can show regulators "request X received on Y,
   fulfilled on Z" (legal-hold retention: 7 years).
4. The nightly retention GC also auto-deletes any LicenseTelemetry row
   past 365 days (default; customizable via env).

The 1-month GDPR fulfillment SLA is comfortably within reach — actual
deletion happens within seconds of the admin running the endpoint.

## Data residency

Aster runs SaaS in `<region>` (current single region; multi-region in
roadmap). Every `LicenseTelemetry` row carries a `data_region` column
recording exactly where it was processed. The transparency panel on
`/admin/license` shows the region for every upload your deployment has
made.

For customers requiring data localization (EU / APAC residency), see
the executed Data Processing Agreement template at
[`dpa-template.md`](./dpa-template.md) — sales executes a per-customer
copy with the agreed residency region.

## Configuration on Aster (SaaS) side — for reference

Secrets live on the `IssuedLicense.payload_json.telemetry.secrets`
array, set at sign time. Rotation appends a new entry; the previous
entry gets `retiredAt` populated and stops verifying. Customers can
have multiple active kids during rotation; cron picks up `kid`
specified by `ASTER_TELEMETRY_SECRET_KID` env.

**At-rest encryption (J3)**: each entry is stored as an AES-256-GCM
envelope under a SaaS-managed Key Encryption Key (KEK). The HMAC
plaintext bytes only ever materialize in memory at upload-verification
time; a database compromise alone does not yield usable secrets. The
KEK is held in Vault and rotated independently via the KEK rotation
runbook (`docs/saas/kek-rotation.md`, SaaS ops only).

Retention: 12 months rolling. Older rows are GC'd by a separate cron
(`/api/cron/telemetry-retention-gc`); deletion is audit-logged for 7
years per GDPR Art 30.

## Threat model

| Attack | Defense |
|--------|---------|
| Forging telemetry for someone else's license | HMAC sign with per-license secret — attacker without secret can't produce a valid signature |
| Replaying a captured payload | SaaS dedupes by (license_id, period_start, period_end); replay is a no-op |
| Sending from a different deployment than the license is bound to | x-aster-deployment-id header cross-checked against license deploymentBinding |
| Sending wildly wrong counts | Out of scope — no anomaly detection; this is signal for sales conversations, not a billing meter |
| DB compromise leaking other customers' HMAC secrets | AES-256-GCM envelope encryption with KEK in Vault. DB-only attacker sees ciphertext + auth tag, no plaintext. (J3) |
