# Telemetry KEK Rotation Runbook (SaaS)

<!-- glossary:block id=kek-rotation-telemetry-kek-rotation-runbook-saas-paragraph-1 -->
This runbook covers rotating the **Key Encryption Key** that wraps
per-license telemetry HMAC secrets stored in
`IssuedLicense.payload_json.telemetry.secrets[]`.
<!-- /glossary:block -->

## What the KEK protects

<!-- glossary:block id=kek-rotation-what-the-kek-protects-paragraph-2 -->
Each licensed deployment ships telemetry signed with a 32-byte HMAC
secret. On the SaaS side we hold an envelope:
<!-- /glossary:block -->

```
{ v: 1, alg: 'AES-256-GCM', kekKid, iv, ct, tag }
```

<!-- glossary:block id=kek-rotation-what-the-kek-protects-paragraph-3 -->
The plaintext HMAC bytes are only ever in RAM at unwrap time. A
database compromise alone does not yield usable secrets — the attacker
needs the KEK from Vault as well.
<!-- /glossary:block -->

## When to rotate

<!-- glossary:block id=kek-rotation-when-to-rotate-list-item-4 -->
- **Scheduled**: every 12 months as part of the SaaS secret review.
<!-- /glossary:block -->
<!-- glossary:block id=kek-rotation-when-to-rotate-list-item-5 -->
- **On-demand**:
  - Suspected Vault exposure.
  - Operator with KEK access leaves the company.
  - Cloud KMS key rotation policy fires.
<!-- /glossary:block -->

<!-- glossary:block id=kek-rotation-when-to-rotate-paragraph-6 -->
The KEK is independent of the license signing key (Ed25519) — rotating
one does **not** require rotating the other.
<!-- /glossary:block -->

## Pre-flight checks

<!-- glossary:block id=kek-rotation-pre-flight-checks-list-item-7 -->
1. Confirm the active KEK in Vault matches what's deployed:
   ```sh
   vault kv get secret/apps/aster-cloud-telemetry-kek
   ```
<!-- /glossary:block -->
<!-- glossary:block id=kek-rotation-pre-flight-checks-list-item-8 -->
2. Confirm the rewrap script runs cleanly in dry-run:
   ```sh
   ASTER_TELEMETRY_SECRET_KEK=<active_hex> \
   ASTER_TELEMETRY_SECRET_KEK_KID=<active_kid> \
   DATABASE_URL=postgres://... \
   pnpm tsx scripts/rewrap-telemetry-secrets.ts
   ```
   The output `secretsWrapped: 0` line proves all rows are already
   envelope-shaped (post-J3 baseline). If non-zero, do not rotate yet —
   migrate first.
<!-- /glossary:block -->

## Rotation procedure

<!-- glossary:block id=kek-rotation-rotation-procedure-paragraph-9 -->
Goal: introduce a new KEK as **active**, demote the old to **prior**,
walk the table to rewrap every row under the new KEK, then drop the
prior KEK from env.
<!-- /glossary:block -->

### Step 1 — Mint the new KEK

```sh
NEW_KEK_HEX=$(openssl rand -hex 32)
NEW_KID="kek-$(date -u +%Y-%m)"
```

Write to Vault:

```sh
vault kv put secret/apps/aster-cloud-telemetry-kek \
  active="$NEW_KEK_HEX" \
  active_kid="$NEW_KID" \
  prior="$OLD_KEK_HEX" \
  prior_kid="$OLD_KID"
```

### Step 2 — Roll out the env to SaaS workloads

<!-- glossary:block id=kek-rotation-step-2-roll-out-the-env-to-saas-workloads-paragraph-10 -->
Bump the ExternalSecret-synced `aster-cloud-telemetry-kek` secret. The
deployment auto-rolls; once all pods pick up the new env they:
<!-- /glossary:block -->

<!-- glossary:block id=kek-rotation-step-2-roll-out-the-env-to-saas-workloads-list-item-11 -->
- Wrap new envelopes under the new KEK (active).
<!-- /glossary:block -->
<!-- glossary:block id=kek-rotation-step-2-roll-out-the-env-to-saas-workloads-list-item-12 -->
- Unwrap old envelopes under the prior KEK (fallback).
<!-- /glossary:block -->

<!-- glossary:block id=kek-rotation-step-2-roll-out-the-env-to-saas-workloads-paragraph-13 -->
Verify by ingesting a fresh upload and confirming `kekKid` on a newly
issued license matches `$NEW_KID`.
<!-- /glossary:block -->

### Step 3 — Rewrap all existing rows

<!-- glossary:block id=kek-rotation-step-3-rewrap-all-existing-rows-paragraph-14 -->
Connect to prod read-write replica and run with `--apply`:
<!-- /glossary:block -->

```sh
ASTER_TELEMETRY_SECRET_KEK="$NEW_KEK_HEX" \
ASTER_TELEMETRY_SECRET_KEK_KID="$NEW_KID" \
ASTER_TELEMETRY_SECRET_KEK_PRIOR="$OLD_KEK_HEX" \
ASTER_TELEMETRY_SECRET_KEK_PRIOR_KID="$OLD_KID" \
DATABASE_URL=postgres://... \
pnpm tsx scripts/rewrap-telemetry-secrets.ts --apply
```

<!-- glossary:block id=kek-rotation-step-3-rewrap-all-existing-rows-paragraph-15 -->
The script unwraps each envelope with whichever KEK matches its
`kekKid`, then rewraps under the active KEK. Output:
<!-- /glossary:block -->

```
{
  "rowsScanned": N,
  "rowsWithTelemetry": M,
  "secretsWrapped": M,
  "rowsUpdated": M,
  "rowsSkipped": ...
}
```

Re-running is idempotent.

### Step 4 — Drop the prior KEK

<!-- glossary:block id=kek-rotation-step-4-drop-the-prior-kek-paragraph-16 -->
Once `secretsWrapped: 0` on a re-run (proving every row is under the
new KEK), remove the prior env vars from Vault:
<!-- /glossary:block -->

```sh
vault kv put secret/apps/aster-cloud-telemetry-kek \
  active="$NEW_KEK_HEX" \
  active_kid="$NEW_KID"
```

<!-- glossary:block id=kek-rotation-step-4-drop-the-prior-kek-paragraph-17 -->
After the next pod rollout, the prior KEK is no longer in the bundle.
<!-- /glossary:block -->

## Failure modes

<!-- glossary:block id=kek-rotation-failure-modes-paragraph-18 -->
| Symptom | Likely cause | Action |
|---|---|---|
| Ingest 400 spike for one customer | Their `payload_json` row got tampered with | check `lastTelemetryUpload` audit and consider DSAR-delete + resign |
| Ingest 400 spike across many customers | KEK in env doesn't match what wrapped the rows | revert env to prior KEK pair; investigate Vault sync drift |
| Rewrap script fails on row N | Corrupt envelope (manual edit?) | skip row, alert ops; manual recovery = mint new secret + email customer |
<!-- /glossary:block -->

## Cross-references

<!-- glossary:block id=kek-rotation-cross-references-list-item-19 -->
- Envelope format: `src/lib/telemetry/envelope.ts`
<!-- /glossary:block -->
<!-- glossary:block id=kek-rotation-cross-references-list-item-20 -->
- Resolver: `src/lib/telemetry/secret-store.ts`
<!-- /glossary:block -->
<!-- glossary:block id=kek-rotation-cross-references-list-item-21 -->
- Migration script: `scripts/rewrap-telemetry-secrets.ts`
<!-- /glossary:block -->
<!-- glossary:block id=kek-rotation-cross-references-list-item-22 -->
- GDPR DPA section: `docs/on-prem/dpa-template.md` §6 (Security
  measures)
<!-- /glossary:block -->
