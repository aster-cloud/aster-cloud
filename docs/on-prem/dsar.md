# Self-service DSAR API for telemetry data

<!-- glossary:block id=dsar-self-service-dsar-api-for-telemetry-data-paragraph-1 -->
The customer-facing **Data Subject Access Request** endpoint lets your
deployment exercise GDPR Art 15 (access) and Art 17 (erasure) against
the telemetry rows we hold on the Aster SaaS side — without filing a
support ticket or logging in to a SaaS dashboard.
<!-- /glossary:block -->

<!-- glossary:block id=dsar-self-service-dsar-api-for-telemetry-data-paragraph-2 -->
Endpoint: `POST https://aster-lang.cloud/api/v1/dsar`
<!-- /glossary:block -->

<!-- glossary:block id=dsar-self-service-dsar-api-for-telemetry-data-paragraph-3 -->
Authentication: per-license HMAC-SHA256 (the **same** secret you already
use for the telemetry uploader). If you have a working
`/api/cron/telemetry-uploader` setup, you already have the credentials
you need.
<!-- /glossary:block -->

## Request shape

Body (HMAC-signed canonical JSON):

```jsonc
{
  "action": "access" | "delete",
  "subject": "license" | "customer",
  "dryRun": false,            // optional; default false
  "dsarRef": "DSAR-2026-0517",// required; recorded in the audit row
  "nonce": "<16+ chars>",
  "timestamp": "2026-05-19T12:00:00.000Z"
}
```

<!-- glossary:block id=dsar-request-shape-paragraph-4 -->
| Field | Required | Notes |
|-------|----------|-------|
| `action` | yes | `access` returns rows; `delete` purges. |
| `subject` | yes | `license` scopes to this license only; `customer` scopes to all licenses owned by the same customer (cross-checked against the license's customer field). |
| `dryRun` | no | When true, no rows are deleted; the response shows the count that would be deleted. Recorded in the audit log as `dry-run-preview`. |
| `dsarRef` | yes | Your internal ticket number; we record it so regulators can match Aster's audit to your own. |
| `nonce` | yes | Anti-replay random bytes (≥ 16 chars). |
| `timestamp` | yes | ISO-8601; rejected if more than ±5 minutes from server time. |
<!-- /glossary:block -->

Headers (identical to ingest):

```
x-aster-license-id:    lic_...
x-aster-customer:      Acme Corp   # or anon-<hex>-<len> when ASTER_TELEMETRY_MASK_CUSTOMER=1
x-aster-deployment-id: <64-hex>    # optional but recommended
x-aster-signature-kid: default
x-aster-signature-alg: HMAC-SHA256
x-aster-signature:     <base64url HMAC over the body>
```

## curl examples

```sh
# 1) Preview a delete (dry-run)
SECRET="$ASTER_TELEMETRY_SECRET"
LIC="lic_abc123"
DEP="aaaaaaaa...aaaaaaaa"   # 64 hex
NOW="$(date -u +%Y-%m-%dT%H:%M:%S.000Z)"
NONCE="$(openssl rand -hex 16)"
BODY=$(jq -c -n --arg ref "DSAR-PREVIEW" --arg ts "$NOW" --arg n "$NONCE" '
  { action:"delete", subject:"license", dryRun:true, dsarRef:$ref, nonce:$n, timestamp:$ts }')
SIG=$(printf '%s' "$BODY" | openssl dgst -binary -sha256 -hmac "$SECRET" \
        | base64 | tr '+/' '-_' | tr -d '=')

curl -sS -X POST https://aster-lang.cloud/api/v1/dsar \
  -H "content-type: application/json" \
  -H "x-aster-license-id: $LIC" \
  -H "x-aster-customer: Acme Corp" \
  -H "x-aster-deployment-id: $DEP" \
  -H "x-aster-signature-kid: default" \
  -H "x-aster-signature-alg: HMAC-SHA256" \
  -H "x-aster-signature: $SIG" \
  -d "$BODY"
# → { "action":"delete", "subject":"license", "licenseId":"lic_abc123", "rowsDeleted": 38, "dryRun": true }
```

```sh
# 2) Apply the deletion after reviewing the preview
BODY=$(jq -c -n --arg ref "DSAR-2026-0517" --arg ts "$NOW" --arg n "$NONCE" '
  { action:"delete", subject:"license", dryRun:false, dsarRef:$ref, nonce:$n, timestamp:$ts }')
SIG=$(printf '%s' "$BODY" | openssl dgst -binary -sha256 -hmac "$SECRET" \
        | base64 | tr '+/' '-_' | tr -d '=')

curl -sS -X POST https://aster-lang.cloud/api/v1/dsar \
  -H "content-type: application/json" \
  -H "x-aster-license-id: $LIC" \
  -H "x-aster-customer: Acme Corp" \
  -H "x-aster-deployment-id: $DEP" \
  -H "x-aster-signature-kid: default" \
  -H "x-aster-signature-alg: HMAC-SHA256" \
  -H "x-aster-signature: $SIG" \
  -d "$BODY"
# → { "action":"delete", ..., "rowsDeleted": 38, "dryRun": false }
```

```sh
# 3) Access request (GDPR Art 15) — receive every row Aster holds
BODY=$(jq -c -n --arg ref "DSAR-ACCESS-001" --arg ts "$NOW" --arg n "$NONCE" '
  { action:"access", subject:"customer", dsarRef:$ref, nonce:$n, timestamp:$ts }')
# ... sign + POST as above ...
# → { "action":"access", "rows":[ ...full LicenseTelemetry rows... ], "retainedFor90DaysAuditOnly": true }
```

## Error responses

<!-- glossary:block id=dsar-error-responses-paragraph-5 -->
All authentication failures return the same `{ "error": "rejected" }`
shape so an attacker cannot probe which licenses exist:
<!-- /glossary:block -->

<!-- glossary:block id=dsar-error-responses-paragraph-6 -->
| HTTP | `reason` | Meaning |
|------|----------|---------|
| 400 | `signature-verify-failed` | Wrong secret / wrong license id / wrong kid. |
| 400 | `customer-mismatch` | `x-aster-customer` header doesn't match the license's customer. |
| 400 | `deployment-id-mismatch` | License is bound to a different deployment. |
| 400 | `invalid-action` / `invalid-subject` | Body shape error. |
| 400 | `stale-timestamp` | More than 5 min skew. |
| 400 | `invalid-nonce` | Missing or <16 chars. |
| 400 | `dsarRef-required` | Missing audit-trail reference. |
| 404 | (empty body) | Endpoint hit on the on-prem build. SaaS only. |
<!-- /glossary:block -->

## Audit trail

<!-- glossary:block id=dsar-audit-trail-paragraph-7 -->
Every request — including `dryRun` previews — writes a row to the
`TelemetryAccessAudit` table on the SaaS side:
<!-- /glossary:block -->

<!-- glossary:block id=dsar-audit-trail-list-item-8 -->
- Action: `read-list` for access, `delete-by-dsar` for committed
  deletes, `dry-run-preview` for previews.
<!-- /glossary:block -->
<!-- glossary:block id=dsar-audit-trail-list-item-9 -->
- Actor: `customer-dsar:<licenseId>` so the source of the request is
  unambiguous in regulator-facing reports.
<!-- /glossary:block -->
<!-- glossary:block id=dsar-audit-trail-list-item-10 -->
- Metadata: `dsarRef`, row count, optional request id.
<!-- /glossary:block -->

<!-- glossary:block id=dsar-audit-trail-paragraph-11 -->
Delete-audit rows are retained 7 years (legal hold); read and dry-run
audits 90 days. See [`telemetry.md`](./telemetry.md) for the retention
contract.
<!-- /glossary:block -->

## Related

<!-- glossary:block id=dsar-related-list-item-12 -->
- Telemetry overview: `docs/on-prem/telemetry.md`
<!-- /glossary:block -->
<!-- glossary:block id=dsar-related-list-item-13 -->
- Per-field GDPR justification: `docs/on-prem/telemetry-fields.md`
<!-- /glossary:block -->
<!-- glossary:block id=dsar-related-list-item-14 -->
- DPA template (Art 28): `docs/on-prem/dpa-template.md`
<!-- /glossary:block -->
<!-- glossary:block id=dsar-related-list-item-15 -->
- Privacy notice (live, customer-facing): `<saas-host>/<locale>/privacy`
<!-- /glossary:block -->
