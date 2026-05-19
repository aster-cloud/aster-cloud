# Telemetry KEK Rotation Runbook (SaaS)

This runbook covers rotating the **Key Encryption Key** that wraps
per-license telemetry HMAC secrets stored in
`IssuedLicense.payload_json.telemetry.secrets[]`.

## What the KEK protects

Each licensed deployment ships telemetry signed with a 32-byte HMAC
secret. On the SaaS side we hold an envelope:

```
{ v: 1, alg: 'AES-256-GCM', kekKid, iv, ct, tag }
```

The plaintext HMAC bytes are only ever in RAM at unwrap time. A
database compromise alone does not yield usable secrets — the attacker
needs the KEK from Vault as well.

## When to rotate

- **Scheduled**: every 12 months as part of the SaaS secret review.
- **On-demand**:
  - Suspected Vault exposure.
  - Operator with KEK access leaves the company.
  - Cloud KMS key rotation policy fires.

The KEK is independent of the license signing key (Ed25519) — rotating
one does **not** require rotating the other.

## Pre-flight checks

1. Confirm the active KEK in Vault matches what's deployed:
   ```sh
   vault kv get secret/apps/aster-cloud-telemetry-kek
   ```
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

## Rotation procedure

Goal: introduce a new KEK as **active**, demote the old to **prior**,
walk the table to rewrap every row under the new KEK, then drop the
prior KEK from env.

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

Bump the ExternalSecret-synced `aster-cloud-telemetry-kek` secret. The
deployment auto-rolls; once all pods pick up the new env they:

- Wrap new envelopes under the new KEK (active).
- Unwrap old envelopes under the prior KEK (fallback).

Verify by ingesting a fresh upload and confirming `kekKid` on a newly
issued license matches `$NEW_KID`.

### Step 3 — Rewrap all existing rows

Connect to prod read-write replica and run with `--apply`:

```sh
ASTER_TELEMETRY_SECRET_KEK="$NEW_KEK_HEX" \
ASTER_TELEMETRY_SECRET_KEK_KID="$NEW_KID" \
ASTER_TELEMETRY_SECRET_KEK_PRIOR="$OLD_KEK_HEX" \
ASTER_TELEMETRY_SECRET_KEK_PRIOR_KID="$OLD_KID" \
DATABASE_URL=postgres://... \
pnpm tsx scripts/rewrap-telemetry-secrets.ts --apply
```

The script unwraps each envelope with whichever KEK matches its
`kekKid`, then rewraps under the active KEK. Output:

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

Once `secretsWrapped: 0` on a re-run (proving every row is under the
new KEK), remove the prior env vars from Vault:

```sh
vault kv put secret/apps/aster-cloud-telemetry-kek \
  active="$NEW_KEK_HEX" \
  active_kid="$NEW_KID"
```

After the next pod rollout, the prior KEK is no longer in the bundle.

## Failure modes

| Symptom | Likely cause | Action |
|---|---|---|
| Ingest 400 spike for one customer | Their `payload_json` row got tampered with | check `lastTelemetryUpload` audit and consider DSAR-delete + resign |
| Ingest 400 spike across many customers | KEK in env doesn't match what wrapped the rows | revert env to prior KEK pair; investigate Vault sync drift |
| Rewrap script fails on row N | Corrupt envelope (manual edit?) | skip row, alert ops; manual recovery = mint new secret + email customer |

## Cross-references

- Envelope format: `src/lib/telemetry/envelope.ts`
- Resolver: `src/lib/telemetry/secret-store.ts`
- Migration script: `scripts/rewrap-telemetry-secrets.ts`
- GDPR DPA section: `docs/on-prem/dpa-template.md` §6 (Security
  measures)
