# Staging deploy + invite-customer runbook

Operator-facing procedure for: (a) deploying a new build to staging.aster-lang.cloud, (b) inviting a customer to a POC, (c) resetting the staging DB between customers.

This runbook assumes the cluster is already healthy and provisioned per `deploy/staging/README.md`.

## Section A: Routine deploy

Both apps deploy via ArgoCD auto-sync. A `git push` to main is enough — but for time-sensitive deploys, force the sync.

### A.1 Standard path (auto-sync)

```bash
# 1. Confirm your commit lands on main
git push origin main

# 2. CI builds the Docker image and pushes to wontlost/aster-cloud:staging-latest (or aster-api:jvm-latest)
gh run watch --repo aster-cloud/aster-cloud  # in another shell

# 3. ArgoCD detects the new image (image puller polls every 3 min) and starts rolling update
KUBECONFIG=~/.kube/k3s-config argocd app get aster-cloud-staging
KUBECONFIG=~/.kube/k3s-config argocd app get aster-api-staging

# 4. Wait for rollout (~2 min)
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging rollout status deploy/aster-cloud
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging rollout status deploy/aster-api

# 5. Smoke test
curl -sI https://staging.aster-lang.cloud/                       | head -1
curl -sI https://staging.aster-lang.cloud/api/policy/q/health    | head -1
# Both should be 200.
```

### A.2 Manual force-sync (when time-sensitive)

```bash
# Trigger ArgoCD sync immediately rather than waiting for the 3-min poll:
KUBECONFIG=~/.kube/k3s-config argocd app sync aster-cloud-staging
KUBECONFIG=~/.kube/k3s-config argocd app sync aster-api-staging
KUBECONFIG=~/.kube/k3s-config argocd app wait aster-cloud-staging --health --timeout 300
KUBECONFIG=~/.kube/k3s-config argocd app wait aster-api-staging --health --timeout 300
```

### A.3 Pinning to a specific image tag

By default ArgoCD picks up `staging-latest`. For a deterministic deploy (e.g., demo with the same build all week):

```bash
# Edit values.yaml in the source repo:
# image:
#   tag: sha-abc1234     # specific commit SHA built by CI

# Commit, push, ArgoCD reconciles.
git commit -am "deploy(staging): pin to sha-abc1234 for $CUSTOMER_NAME demo"
git push origin main
```

Unpin after the demo by reverting to `staging-latest`.

## Section B: Invite a customer to a POC

### B.1 Pre-flight check (T - 2 days)

- [ ] Staging is currently green: `argocd app list` shows all aster-staging apps `Synced/Healthy`
- [ ] No active incident in staging
- [ ] You have customer's intended email + organization name + expected user count

### B.2 Provision the customer org (T - 1 day)

Create the org via the admin API. Run from your laptop with prod-ops kubeconfig + AUTH_SECRET access.

```bash
# 1. Get an admin session token (the staging admin account, per 1Password)
ADMIN_EMAIL="admin@aster-lang.cloud"
ADMIN_PASSWORD=$(op item get "Staging admin (aster-lang.cloud)" --field password)

# 2. Authenticate to NextAuth
curl -c /tmp/staging-cookies.txt -X POST https://staging.aster-lang.cloud/api/auth/callback/credentials \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=$ADMIN_EMAIL&password=$ADMIN_PASSWORD"

# 3. Create the org
CUSTOMER_ORG_SLUG="acme-corp"
CUSTOMER_EMAIL="alice@acme-corp.example"
curl -b /tmp/staging-cookies.txt -X POST https://staging.aster-lang.cloud/api/admin/orgs \
  -H "Content-Type: application/json" \
  -d "{\"slug\":\"$CUSTOMER_ORG_SLUG\",\"name\":\"ACME Corp\",\"adminEmail\":\"$CUSTOMER_EMAIL\",\"plan\":\"pro\",\"trialDays\":30}"

# 4. Generate the invite link (or send via email — your choice)
curl -b /tmp/staging-cookies.txt -X POST "https://staging.aster-lang.cloud/api/admin/orgs/$CUSTOMER_ORG_SLUG/invites" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$CUSTOMER_EMAIL\",\"role\":\"admin\",\"channel\":\"link\"}" | jq -r '.inviteUrl'
```

### B.3 Send the invite (T - 0)

Use the email template at `docs/templates/customer-poc-invite.md` (replace placeholders). Send via your normal email — the link is `https://staging.aster-lang.cloud/invite/<token>` and expires in 7 days.

Include in the email:
- The invite link
- The credentials for their dedicated test policy module (pre-seed with their use case)
- A link to the customer-facing docs
- Your Slack/email for support during the POC

### B.4 During the POC (1-4 weeks)

- Add the customer to Pingdom's "customer-watch" check group (extra synthetic checks pointed at their org)
- Monitor #alerts-prod for their tenant ID in error logs
- Daily: glance at the org's quota/usage in the admin dashboard
- Schedule a midpoint sync at week 2

### B.5 At POC end

- [ ] Export their dashboard data via `/api/v1/dsar` (gives them a portable JSON)
- [ ] Delete their org via `/api/admin/orgs/<slug>` DELETE (cascade soft-deletes everything)
- [ ] Move them to production org (separate flow, see prod docs)

## Section C: Reset the staging DB between customers

When a POC ends and the next is starting, you usually want a clean DB. Three levels of reset:

### C.1 Soft reset (clear test data only)

Drop all `*_test` orgs but keep the schema + admin accounts:

```bash
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging exec -it postgres-staging-1 -- \
  psql -U aster_admin -d aster_cloud -c "
    DELETE FROM organizations
    WHERE slug LIKE '%-test'
       OR slug LIKE '%-poc'
       OR created_at < now() - interval '90 days';
  "
# Cascade-delete handles dependent rows (users, policies, sessions, etc.)
```

### C.2 Schema reset (drop everything, re-run migrations)

WARNING: This wipes everything including admin accounts. You'll need to re-seed.

```bash
# 1. Take a snapshot first (in case)
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging exec postgres-staging-1 -- \
  pg_dump -U aster_admin aster_cloud | gzip > /tmp/staging-snapshot-$(date +%s).sql.gz

# 2. Drop + recreate
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging exec -it postgres-staging-1 -- \
  psql -U aster_admin -d postgres -c "DROP DATABASE aster_cloud;"
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging exec -it postgres-staging-1 -- \
  psql -U aster_admin -d postgres -c "CREATE DATABASE aster_cloud OWNER aster_admin;"

# 3. Trigger re-migration via a pod restart (drizzle migrate runs at startup)
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging rollout restart deploy/aster-cloud
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging rollout status deploy/aster-cloud

# 4. Re-seed the admin user (run the seed script via a one-off Job)
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging create job --from=cronjob/seed-admin seed-admin-$(date +%s)
```

### C.3 Full cluster reset (nuclear option)

Re-create the entire CNPG cluster from scratch. Useful for testing the DR drill or after a corruption.

```bash
# 1. Delete the cluster CR (CNPG operator deletes pods + PVCs)
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging delete cluster postgres-staging

# 2. Wait for full cleanup
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging wait \
  --for=delete cluster/postgres-staging --timeout=5m

# 3. Re-apply via ArgoCD
KUBECONFIG=~/.kube/k3s-config argocd app sync postgres-staging

# 4. Wait for the new cluster to bootstrap (~3 min)
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging wait \
  --for=condition=Ready cluster/postgres-staging --timeout=10m

# 5. Re-deploy the apps so they pick up fresh DB connections
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging rollout restart deploy/aster-cloud
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud-staging rollout restart deploy/aster-api
```

## Section D: Common gotchas

### "ExternalSecret not syncing"
The OCI Vault auth token may have expired. Re-issue via:
```bash
KUBECONFIG=~/.kube/k3s-config kubectl -n external-secrets logs deploy/external-secrets -c manager --tail 100 | grep -i error
```
If you see "401" errors, refresh the OCI Vault binding (see `docs/runbooks/secrets-rotation.md`, section "OCI Vault token").

### "Customer reports timeout on policy evaluation"
Likely the GraalVM engine is cold. First evaluation per process takes ~500ms; subsequent are <50ms. Either:
- Pre-warm: hit `/api/v1/policies/evaluate-source` with a dummy policy as part of the deploy
- Wait it out (no action needed; subsequent calls are fast)

### "Customer can't access the admin panel"
The default invite gives the role `member`. To elevate to `admin`:
```bash
curl -b /tmp/staging-cookies.txt -X PATCH "https://staging.aster-lang.cloud/api/admin/orgs/$ORG_SLUG/users/$USER_EMAIL" \
  -H "Content-Type: application/json" \
  -d '{"role":"admin"}'
```

### "ArgoCD sync stuck"
Usually a webhook or RBAC issue:
```bash
KUBECONFIG=~/.kube/k3s-config argocd app get aster-cloud-staging
# Look for the "Conditions" section. Common: "SyncError: ..."
KUBECONFIG=~/.kube/k3s-config argocd app sync aster-cloud-staging --force
```

## Related

- `deploy/staging/README.md` — environment topology
- `deploy/staging/dns-tls.md` — DNS + TLS setup
- `docs/runbooks/rollback.md` — when a deploy goes wrong
- `docs/runbooks/incident-response.md` — when staging breaks during a POC
- `docs/templates/customer-poc-invite.md` — email template
