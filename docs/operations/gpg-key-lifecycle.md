---
last-reviewed-at: 2026-05-20
owner: '@aster/platform'
reviewer: '@aster/glossary-stewards'
review-cadence: semi-annual
---

# Runbook — GPG key lifecycle

**Plan**: `.claude/plan/glossary-contract.md` v7 §1.7.2 + §11
**Scope**: The two GPG keys used by the Glossary Contract release infrastructure.

## Two keys

### `glossary-release-eng-key` (Vault-held)

- **Purpose**: Signs `releases/denylist.json` and any emergency manual
  signing.
- **Storage**: Vault under path `kv/glossary/release-eng-key`.
- **Access**: bound to `@aster/glossary-stewards` Vault role.
- **Operator**: human release engineer with steward role.

### `glossary-ci-signing-key` (KMS-backed via OIDC)

- **Purpose**: Signs release manifests (`releases/<version>.json`)
  during state machine transitions.
- **Storage**: GCP KMS or AWS KMS (org choice; documented in
  `glossary-prerequisites.md`). Private key NEVER leaves KMS.
- **Access**: Only the publish workflow can call `kms:sign`, via
  GitHub OIDC short-lived tokens scoped to the
  `production-publish-*` environments.
- **Operator**: CI service account.

## Why two keys

- The CI key needs to be invokable from automation, but **must not be
  extractable** even by a GitHub admin compromise → OIDC + KMS
  separation of duties (v7 H1 hardening item).
- The release-engineer key needs to be human-operable for emergency
  signing (out-of-band denylist when CI is unavailable) → Vault.
- Distinct keys mean a single compromise doesn't tank both surfaces.

## Rotation cadence

- **Scheduled annual rotation** for both keys.
- **Emergency rotation** within 24h on suspected compromise.

## Annual rotation procedure

### `glossary-ci-signing-key`

1. Provision new KMS key version in the cloud provider.
2. Update OIDC binding to permit `kms:sign` on the new version.
3. Update `.github/workflows/publish-*.yml` to use the new key version.
4. Verify with a no-op release (RC only, no promote).
5. After 7 days of successful operation, retire the previous version
   via cloud KMS rotation feature.
6. Bundled public key in the next `@aster-cloud/glossary` release
   includes both old and new (trust-store overlap), then drops old
   in the release after.

### `glossary-release-eng-key`

1. Generate new GPG key on the release engineer's signed-key-ceremony
   workstation.
2. Upload public key to Vault path `kv/glossary/release-eng-key-pub-v<N>`.
3. Update `aster-cloud/packages/glossary/src/trust-store/` with the
   new public key (will ship in next release).
4. Verify with a manual sign of a test denylist entry.
5. After 30 days of successful operation, revoke the previous key
   (move private from Vault to archive; clear from prod path).
6. The release after this one drops the old public key from the
   trust store.

## Departure procedure (release engineer leaves)

1. Within 24h of departure notification, revoke the departing
   engineer's access to the Vault `glossary-stewards` role.
2. Generate a new GPG key for the replacement engineer per the
   procedure above.
3. Within 7 days, complete the key rotation so the departing
   engineer's keys are no longer trusted.

If departure is hostile (security incident):

- **Emergency rotation** within 24h, not 7 days.
- Out-of-band denylist push to invalidate any release signed by the
  compromised key since the suspected compromise time.

## Emergency rollover (suspected compromise mid-release-cycle)

1. Pause all releases (no `npm publish`, no OSSRH releases).
2. Verify the suspected compromise (Vault audit log, KMS CloudTrail).
3. If confirmed, follow Departure procedure above.
4. Publish out-of-band signed denylist listing every release signed
   by the compromised key since suspected compromise time, signed
   by the *new* key.
5. File an incident report in `docs/operations/glossary-incidents/`.

## Trust store distribution

Public keys are bundled in **both** the `@aster-cloud/glossary` npm
package and the Maven artifact (offline trust store). Consumers
verify against the bundled set; they NEVER contact a keyserver. This
avoids keyserver-availability risk during cascade outages.

When a key is rotated, the trust store in the *next* package release
includes both old and new. The release after that drops the old.
Consumer machines update on `pnpm install --frozen-lockfile` cadence.

## Related runbooks

- `glossary-prerequisites.md` — initial key provisioning.
- `rc-and-recovery.md` — RC flow that uses both keys.
- `cascade-outage.md` — what to do when KMS or Vault is unavailable.
