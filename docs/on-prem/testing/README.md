# On-prem license-flow E2E harness

Toolset for exercising the full license verification + revocation state machine end-to-end against a real on-prem build of aster-cloud. Used to validate that the Ed25519 signing path, deployment-binding check, expiry computation, revocation cache, and grace-period write-gate all behave per `enterprise-deployment-guide.md` §1-3.

## Contents

| File | Purpose |
|---|---|
| `sign-license.mjs` | Generate Ed25519 keypairs (`keygen`), sign v2 license payloads (`sign`), sign revocation manifests (`sign-revocation`). |
| `revocation-mock.mjs` | Tiny HTTP server that serves a fixed revocation manifest on port 7700. |
| `README.md` | This file — full 8-stage runbook. |

## When to use

- Validating a new license-related fix end-to-end on a real Node runtime (verify-licence unit tests cover the state machine but not the runtime-gate / read-only banner integration).
- Sanity-checking that `ASTER_TEST_TRUST_BUNDLE_EXTRA` correctly extends the trust bundle so future operators can drop in test keys without modifying source.
- Before publishing a new license-key-ceremony rotation: re-run all 8 stages with the new key material to confirm rotation doesn't break the verify path.

**Not for**: production licence ceremonies. Production keys live in Vault Transit per `aster-deploy/docs/license-key-ceremony.md`.

## Prerequisites

- Node 22+ with `crypto.subtle.importKey('Ed25519', …)` support
- Podman 5.x (for the backend + Postgres + Redis side cars)
- A built on-prem aster-cloud bundle (`pnpm build:next` with `DEPLOYMENT_MODE=on-prem`)
- `pnpm exec drizzle-kit push --force` against a fresh `aster_cloud` DB
- A seeded admin user (`pnpm seed:admin`)

## Runbook

The full 8-stage flow takes ~30 minutes by hand. Each stage assumes the previous infra is up; only the license key + DB cache row change between stages.

### Bootstrap (run once)

```bash
# 1. Generate license + revocation keypairs (process-exit destroys the in-memory
#    keys; PEM files contain the private keys — delete after the test session).
node sign-license.mjs keygen --key-id e2e-lic-2026 2>e2e-lic.meta.json > e2e-lic.pem
node sign-license.mjs keygen --key-id e2e-rev-2026 2>e2e-rev.meta.json > e2e-rev.pem

# 2. Build the JSON extra-bundle payload for ASTER_TEST_TRUST_BUNDLE_EXTRA.
#    (jq makes this less tedious; the format is documented in license-trust-bundle.ts)
LIC_PUB=$(jq -r .pubKey e2e-lic.meta.json); LIC_FP=$(jq -r .fingerprint e2e-lic.meta.json)
REV_PUB=$(jq -r .pubKey e2e-rev.meta.json); REV_FP=$(jq -r .fingerprint e2e-rev.meta.json)
EXTRA='[
  {"keyId":"e2e-lic-2026","purpose":"license","pubKey":"'$LIC_PUB'","status":"active","activatedAt":"2026-05-24T00:00:00.000Z","fingerprint":"'$LIC_FP'"},
  {"keyId":"e2e-rev-2026","purpose":"revocation","pubKey":"'$REV_PUB'","status":"active","activatedAt":"2026-05-24T00:00:00.000Z","fingerprint":"'$REV_FP'"}
]'

# 3. Compute the deployment ID. The license-binding check fails-closed if this
#    env doesn't equal payload.deploymentBinding.deploymentId.
DEPLOY_ID=$(printf 'local-e2e' | shasum -a 256 | cut -d' ' -f1)

# 4. Backend + DB infra (podman). See the perf benchmark README for the exact
#    container recipe — same pattern, different network name.
podman network create lic-net
podman run -d --name lic-pg --network lic-net -p 55432:5432 \
  -e POSTGRES_USER=aster -e POSTGRES_PASSWORD=aster -e POSTGRES_DB=aster_policy \
  postgres:17-alpine
podman run -d --name lic-redis --network lic-net -p 56379:6379 redis:7-alpine
sleep 4
podman exec lic-pg psql -U aster -d aster_policy -c "CREATE DATABASE aster_cloud OWNER aster;"
podman run -d --name lic-api --network lic-net -p 58080:8080 --cpus 2 --memory 2g \
  -e QUARKUS_DATASOURCE_USERNAME=aster -e QUARKUS_DATASOURCE_PASSWORD=aster \
  -e QUARKUS_DATASOURCE_JDBC_URL=jdbc:postgresql://lic-pg:5432/aster_policy \
  -e QUARKUS_DATASOURCE_REACTIVE_URL=postgresql://lic-pg:5432/aster_policy \
  -e QUARKUS_REDIS_HOSTS=redis://lic-redis:6379 \
  -e ASTER_SECURITY_SIGNATURE_ENABLED=false -e ASTER_SECURITY_APIKEY_ENABLED=false \
  -e ASTER_PLAN_GATE_ENABLED=false -e ASTER_RATELIMIT_ENABLED=false \
  -e QUARKUS_OTEL_SDK_DISABLED=true \
  -e JAVA_OPTS="-Xmx1g -Xms256m -XX:+UseG1GC" \
  aster/policy-api:e2e

# 5. Migrate cloud DB + seed admin.
DATABASE_URL='postgresql://aster:aster@localhost:55432/aster_cloud' \
  pnpm -C ../../../ exec drizzle-kit push --force
DATABASE_URL='postgresql://aster:aster@localhost:55432/aster_cloud' \
  ADMIN_EMAIL='admin@local.test' ADMIN_INITIAL_PASSWORD='LocalE2E!2026' \
  pnpm -C ../../../ seed:admin
```

### Stage 1-3 — verified + active happy path

```bash
node sign-license.mjs sign \
  --priv-key-file e2e-lic.pem \
  --key-id e2e-lic-2026 --license-id e2e-001 \
  --customer "E2E Test Tenant" --tier enterprise --expires-in 90d \
  --deployment-id "$DEPLOY_ID" > lic-90d.key

LIC_KEY=$(cat lic-90d.key)

# Start the on-prem cloud server. Note ASTER_ALLOW_DEV_TRUST_BUNDLE=true is
# REQUIRED to load the dev placeholder bundle + the env-injected test keys
# in a NODE_ENV=production runtime.
cd ../../../.next/standalone
PORT=3000 HOSTNAME=127.0.0.1 \
  NODE_ENV=production DEPLOYMENT_MODE=on-prem \
  ASTER_ALLOW_DEV_TRUST_BUNDLE=true \
  ASTER_TEST_TRUST_BUNDLE_EXTRA="$EXTRA" \
  ASTER_DEPLOYMENT_ID="$DEPLOY_ID" \
  LICENSE_KEY="$LIC_KEY" \
  NEXT_PUBLIC_ASTER_POLICY_API_URL=http://localhost:58080 \
  DATABASE_URL='postgresql://aster:aster@localhost:55432/aster_cloud' \
  AUTH_SECRET='lic-e2e-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  NEXTAUTH_SECRET='lic-e2e-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  CRON_SECRET='lic-e2e-cron' NEXT_PUBLIC_APP_URL='http://localhost:3000' \
  NEXTAUTH_URL='http://localhost:3000' ASTER_PLAN_GATE_HMAC_KEY='lic-e2e-hmac' \
  SSO_PROVIDER='none' \
  node server.js &
```

Browser: log in → visit `/admin/license`. Expected:
- Status: **"Lizenz verifiziert und aktiv"**
- daysRemaining: ~89
- No read-only banner
- ADMIN sidebar section visible

### Stage 4 — expiring-soon

Re-sign with `--expires-in 7d`, restart cloud, refresh page. Expected:
- Status: **"Lizenz läuft bald ab — 6 Tage verbleibend"**
- New CTA: "Verlängerungsteam kontaktieren"
- Still active, no read-only banner

### Stage 5 — expired

Re-sign with `--expires-in -5d` (note the minus), restart. Expected:
- Banner: **"NUR-LESEN-MODUS"** + "Diese Lizenz ist abgelaufen."
- Status: **"Lizenz abgelaufen — Vor 6 Tagen abgelaufen"**
- daysRemaining: **-6**

### Stage 6 — revoked via manifest

Re-sign a fresh 90d license, but pre-populate `licenseCache` row marking it as revoked. (The runtime gate reads from this row; revocation refresh would populate it in production but we bypass that loop for the test.)

```sql
INSERT INTO "LicenseCache" (
  id, license_id, license_key_hash, payload_json, signing_key_id, verified_at,
  revocation_version, revocation_published_at, revocation_fetched_at,
  last_successful_revocation_check_at, is_revoked, revoked_at, revoked_reason
) VALUES (
  'current', 'e2e-004-revoked', 'fakehash', '{"licenseId":"e2e-004-revoked"}'::jsonb,
  'e2e-lic-2026', NOW(), 1, NOW(), NOW(), NOW(),
  true, NOW(), 'security'
) ON CONFLICT (id) DO UPDATE SET
  license_id = EXCLUDED.license_id, is_revoked = true, revoked_at = NOW(),
  revoked_reason = 'security', updated_at = NOW();
```

Expected:
- Banner: **"NUR-LESEN-MODUS"** + "Diese Lizenz wurde widerrufen."
- Status: **"Lizenz widerrufen — kryptografisch gültig, steht aber auf der Widerrufsliste"**
- daysRemaining: 89 (so NOT expired — pure revocation override)

### Stage 7 — signature-untrusted-key

Generate a stranger key whose pubKey is NOT in the trust bundle:

```bash
node sign-license.mjs keygen --key-id stranger-lic-2026 2>stranger.meta > stranger.pem
node sign-license.mjs sign --priv-key-file stranger.pem --key-id stranger-lic-2026 \
  --license-id e2e-005-stranger --customer "Stranger" --tier enterprise \
  --expires-in 90d --deployment-id "$DEPLOY_ID" > lic-stranger.key
```

Restart cloud with `LICENSE_KEY=$(cat lic-stranger.key)`. Expected:
- Banner: **"NUR-LESEN-MODUS"** + "Lizenzschlüssel ist fehlerhaft."
- Status: **"Signaturschlüssel ist nicht vertrauenswürdig"**
- License payload details NOT rendered (untrustworthy)

### Stage 8 — revocation outage + grace expiry

Re-use the stage 1-3 90d license.

**8a (within grace):**
```sql
UPDATE "LicenseCache" SET
  is_revoked = false,
  last_successful_revocation_check_at = NOW() - INTERVAL '2 days',
  last_revocation_error = '{"url":"...","networkError":"connect ECONNREFUSED"}'::jsonb,
  updated_at = NOW()
WHERE id = 'current';
```

Restart cloud, refresh. Expected:
- Status: **"Widerrufsprüfung vorübergehend veraltet"**
- Revocation status: **"Kulanzfrist aktiv"**
- License details visible, no read-only banner

**8b (grace expired):**
```sql
UPDATE "LicenseCache" SET
  last_successful_revocation_check_at = NOW() - INTERVAL '10 days',
  updated_at = NOW()
WHERE id = 'current';
```

Restart cloud (in-process cache must clear). Expected:
- Banner: **"NUR-LESEN-MODUS"** + "Die Kulanzfrist der Widerrufsprüfung ist abgelaufen."
- Status: **"Kulanzfrist für Widerrufsprüfung beendet"**
- Revocation status: **"Verbindung muss wiederhergestellt werden"**

### Teardown

```bash
# Stop cloud (Ctrl-C or pkill)
lsof -ti :3000 | xargs kill -9

# Stop infra
podman rm -f lic-api lic-pg lic-redis
podman network rm lic-net
podman rmi aster/policy-api:e2e

# WIPE PRIVATE KEYS — these are signing keys; never leave them on disk
shred -uvz e2e-lic.pem e2e-rev.pem stranger.pem 2>/dev/null || \
  rm -fP e2e-lic.pem e2e-rev.pem stranger.pem
rm -f e2e-lic.meta.json e2e-rev.meta.json stranger.meta.json
rm -f lic-*.key rev-*.json
```

## Trust-bundle injection contract

The on-prem build looks for `ASTER_TEST_TRUST_BUNDLE_EXTRA` at module load. The value is JSON: an array of `TrustBundleEntry` objects (see `src/lib/license-trust-bundle.ts`). Two safety guards:

1. **`ASTER_ALLOW_DEV_TRUST_BUNDLE=true` is required.** Without it, the on-prem runtime fail-fasts because the base bundle still contains `__dev-*` placeholder keys.
2. **`ASTER_TEST_TRUST_BUNDLE_EXTRA` set without that env throws** with an explicit error — no silent extension of the trust bundle in a production-shaped runtime.

SaaS builds never set either env. Production on-prem deployments must not set either env (the release pipeline replaces `__dev-*` entries with real Vault-extracted public keys).

## What this harness does NOT cover

- **Real revocation fetch loop**: we manipulate `licenseCache` directly. The full refresh path (HTTP fetch → signature verify → version comparison → DB write) is unit-tested in `src/__tests__/lib/license-revocation*.test.ts` and lightly integration-tested via `revocation-mock.mjs` — but the periodic refresh cron that drives this from the cloud server is not invoked in this harness.
- **mTLS / cert-manager**: that's K8s-deployment-layer cert handling, separate from license signing.
- **License migration / rotation**: requires the second `verify-only` keypair in the trust bundle and a re-signed license. Out of scope; the harness is single-key.

## Reference: license + revocation contract

| Surface | Source | Notes |
|---|---|---|
| License key format | `src/lib/license.ts` `V2_PREFIX` | `aster-ent-v2-<keyId>-<base64url(payload)>.<base64url(sig)>` |
| Payload schema | `src/lib/license.ts` `LicensePayloadV2` | Includes `deploymentBinding.deploymentId`, `sku`, `revocationCheckUrl` (HTTPS for standard SKU) |
| Status state machine | `src/lib/license.ts` `verifyLicenseKey` | trust × entitlement × connectivity → displayStatus |
| Trust bundle | `src/lib/license-trust-bundle.ts` `ASTER_TRUST_BUNDLE` | `BASE_BUNDLE + readExtraBundle()` |
| Revocation cache | `LicenseCache` table | Single row id='current'; populated by refresh loop |
| Grace windows | `src/lib/license-revocation.ts` | `DEFAULT_STALENESS_WINDOW_MS = 25h`, `DEFAULT_GRACE_WINDOW_MS = 7d` |
| Read-only gate | `src/lib/license-runtime-gate.ts` `gateFromStatus` | Triggered on missing / binding-mismatch / malformed / revoked / expired / grace-expired |
