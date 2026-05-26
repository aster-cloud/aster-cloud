# License-key ceremony rehearsal

Quarterly dry-run of the full license-signing-key rotation. Goal: when the real ceremony needs to happen (key compromise, scheduled rotation, signing party leaving), the operator has muscle memory and we've verified the runbook works end-to-end.

**Do NOT do this against production.** This is a rehearsal in `staging.aster-lang.cloud` (see [`staging-deploy.md`](staging-deploy.md)).

## Pre-flight

- [ ] Staging is healthy: `https://staging.aster-lang.cloud/admin/license` reports verified+active
- [ ] You have Vault Transit access (`vault token lookup` succeeds)
- [ ] You can edit `src/lib/license-trust-bundle.ts` + push to staging branch
- [ ] Two operators present (four-eyes on key generation)

## Procedure (~45 min)

### Step 1 — Generate the new keypair in Vault (10 min)

```bash
# Create new key in Vault Transit. Naming convention from the
# original ceremony: `lic-YYYY-QN`.
vault write -f transit/keys/lic-2026-Q3 type=ed25519

# Export the public key (private NEVER leaves Vault):
vault read transit/keys/lic-2026-Q3 -format=json \
  | jq -r '.data.keys."1".public_key' > /tmp/lic-2026-Q3.pub

# Compute the fingerprint expected by ASTER_TRUST_BUNDLE:
PUB_RAW=$(cat /tmp/lic-2026-Q3.pub | base64 -d | tail -c 32 | base64)
FP=$(echo -n "$PUB_RAW" | base64 -d | sha256sum | cut -d' ' -f1)
echo "pubKey:      $PUB_RAW"
echo "fingerprint: $FP"
```

**Both operators verify the printed pubKey + fingerprint match.** Write them on paper. The paper goes in the safe; the operators have to physically agree.

### Step 2 — PR the trust bundle update (5 min)

```bash
git checkout -b ceremony/add-lic-2026-Q3
# Edit src/lib/license-trust-bundle.ts BASE_BUNDLE:
#   Add new entry with keyId='lic-2026-Q3', purpose='license',
#   pubKey=$PUB_RAW, fingerprint=$FP, status='active'
#   Mark the OLD active key status='verify-only' (still trusted
#   for outstanding licenses, but new signings use the new key).
git add src/lib/license-trust-bundle.ts
git commit -m "feat(license): add lic-2026-Q3 to trust bundle; retire lic-2026-Q2"
git push origin ceremony/add-lic-2026-Q3
# Open PR. The fingerprint-cross-check assertion (d053d8a) will fail
# if pubKey/fingerprint don't match — verifies our hand calculations.
```

CI must pass before merge. **In particular**:
- `pnpm test:run` re-runs the trust-bundle fingerprint assertion
- on-prem-build verifies the bundle still loads in production-shaped runtime

### Step 3 — Deploy to staging (10 min)

```bash
# Merge ceremony branch to main → Cloudflare auto-deploys SaaS
# (but SaaS doesn't reach verify path, so this is silent)
# ArgoCD auto-syncs staging on-prem (which DOES reach verify path)
argocd app sync aster-cloud-staging

# Wait for rollout:
kubectl -n aster-cloud-staging rollout status deploy/aster-cloud
```

### Step 4 — Sign a test license with new key (10 min)

```bash
# Generate test payload + sign with new Vault key
cat > /tmp/test-payload.json <<EOF
{
  "schemaVersion": 2,
  "licenseId": "rehearsal-$(date +%s)",
  "keyId": "lic-2026-Q3",
  "customer": "Rehearsal Tenant",
  "issuedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "expiresAt": "$(date -u -d '+90 days' +%Y-%m-%dT%H:%M:%SZ)",
  "seatLimit": 50,
  "tier": "enterprise",
  "features": [],
  "sku": "standard",
  "licenseTerm": "annual",
  "deploymentBinding": {
    "deploymentId": "$STAGING_DEPLOYMENT_ID",
    "deploymentLabel": "Staging Rehearsal"
  },
  "revocationCheckUrl": "https://revocations.aster-lang.cloud/v1/manifest.json"
}
EOF

# Sign via Vault (private key never leaves Vault)
PAYLOAD_B64=$(cat /tmp/test-payload.json | base64 | tr -d '\n' | tr '+/=' '-_')
SIG_B64=$(vault write transit/sign/lic-2026-Q3 \
  input="$(cat /tmp/test-payload.json | base64)" \
  signature_algorithm=ed25519 \
  | grep signature | awk '{print $2}' | sed 's/vault:v1://')

# Assemble the LICENSE_KEY:
LIC="aster-ent-v2-lic-2026-Q3-${PAYLOAD_B64}.${SIG_B64}"
echo "$LIC"
```

### Step 5 — Apply test license to staging (5 min)

```bash
kubectl -n aster-cloud-staging create secret generic license-key-rehearsal \
  --from-literal=LICENSE_KEY="$LIC" \
  --dry-run=client -o yaml | kubectl apply -f -

kubectl -n aster-cloud-staging set env deploy/aster-cloud \
  LICENSE_KEY="$LIC" \
  ASTER_DEPLOYMENT_ID="$STAGING_DEPLOYMENT_ID"

kubectl -n aster-cloud-staging rollout status deploy/aster-cloud
```

### Step 6 — Verify (5 min)

Browser → `https://staging.aster-lang.cloud/admin/license` → expect:
- Status: **"License verified and active"**
- Signing key ID: **lic-2026-Q3**
- Days remaining: ~89

If anything else: ABORT, roll back via Step 7. Don't proceed to production rotation.

### Step 7 — Rollback (if any step failed)

```bash
# Revert the trust-bundle PR
git revert <commit-sha>
git push

# ArgoCD will auto-sync staging back to old state. Wait for rollout.
# Old LICENSE_KEY (signed by retiring key) is now back to verified.
```

## Sign-off checklist

After successful rehearsal:

- [ ] Both operators sign the paper ceremony record (kept in safe)
- [ ] File rehearsal report at `docs/runbooks/ceremony-log/YYYY-QN.md`
- [ ] Note any procedural fixes back into this runbook
- [ ] Note expected duration / actual duration (drift > 50% means revise estimate)
- [ ] Schedule next quarterly rehearsal in calendar
- [ ] Confirm `staging.aster-lang.cloud` was restored to a stable license at end of rehearsal

## Real-world ceremony differences

When this becomes "the real thing" (not a rehearsal):

| Rehearsal | Real ceremony |
|---|---|
| Target = staging | Target = production after staging verified |
| Old key kept as `verify-only` for 90 days | Old key + new key both active for 90 day overlap |
| Test customer = `rehearsal-*` | Test customer = first paying on-prem customer to opt in |
| Slack #ops notification optional | All-hands notification 7 days ahead |
| Recovery via revert PR | Recovery via revert PR + outbound customer comms |

## Why we rehearse

The license-signing key is the highest-impact secret in the system:
- Compromise = attacker can forge any license for any customer
- Loss = no way to issue licenses to new customers; existing ones survive but you can't ship a fix to them without a new ceremony
- Bad rotation = trust bundle mismatch → every on-prem customer's `/admin` page locks into read-only mode

Quarterly rehearsal means when the real moment comes, nobody is reading docs at 3 AM.
