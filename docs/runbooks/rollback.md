# 5-minute rollback procedure

When something breaks in production and you need to revert quickly. Three rollback surfaces; pick the right one based on what changed.

## Decision tree

```
Did the issue start RIGHT AFTER a deploy?
│
├─ Cloudflare Workers (aster-cloud SaaS frontend + BFF)
│  → Section A: Cloudflare rollback (~30 sec)
│
├─ K3S deployment (aster-api on-prem backend)
│  → Section B: ArgoCD rollback (~2 min)
│
└─ Database migration just ran (drizzle migrate or flyway)
   → Section C: DB rollback (~5 min, riskier — see Section D first)

Did the issue start with no apparent deploy?
→ Skip rollback; this is an environmental issue (Cloudflare outage,
  Hyperdrive pool exhaustion, etc.). See incident-response.md.
```

## A. Cloudflare Workers rollback

Worker code shipped via Cloudflare's git integration. Rollback is `wrangler rollback`.

```bash
# 1. See recent deploys (most recent first)
wrangler deployments list --name aster-cloud | head -10
# Output: deployment ID, source (git commit), created timestamp

# 2. Roll back to the previous deploy (one before current):
wrangler rollback --name aster-cloud --message "incident-12345"

# 3. Verify within 30 seconds:
curl -sI https://aster-lang.cloud/ | head -3
# Expect: HTTP/2 200 (or 307 if locale redirect)

# 4. Tail logs to confirm rollback took:
wrangler tail aster-cloud --format pretty | head -20
```

**Caveats**:
- Rollback reverts code but NOT secrets. If the breakage was from a wrong `wrangler secret put`, you also need to `wrangler secret put` with the old value (from 1Password).
- Hyperdrive bindings don't roll back with code. If a recent migration changed how the Worker calls the DB, rollback alone won't help.
- Migration changes need Section C in addition.

## B. ArgoCD rollback (K3S aster-api)

aster-api ships via ArgoCD auto-sync. Rollback by reverting the source commit.

```bash
# 1. Identify the bad commit
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud describe deploy/aster-api \
  | grep -E "Image|Updated"
# This shows the docker image tag (= git SHA). Find the previous one:
gh run list --workflow ci.yml --repo aster-cloud/aster-api --limit 10

# 2. Revert the commit on main (creates a NEW commit)
git revert <bad-sha>
git push origin main

# 3. CI rebuilds; ArgoCD picks up the new image; rolling update starts
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud rollout status deploy/aster-api

# 4. If you can't wait for CI (urgent!), force-set the image tag:
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud set image \
  deploy/aster-api aster-api=wontlost/aster-api:<previous-sha>
# NOTE: This will be REVERTED by ArgoCD on its next sync (usually 3min).
# Only use this as a 5-min bridge while waiting for the proper revert PR.
```

**Caveats**:
- `kubectl set image` is overridden by ArgoCD. Always do the `git revert` for the durable rollback.
- If aster-api restart is impossible (CrashLoopBackOff), scale to 0: `kubectl scale deploy/aster-api --replicas=0`. SaaS traffic falls back to whatever cached behavior exists; on-prem customers see 503. Communicate.

## C. Drizzle migration rollback (aster-cloud DB)

Drizzle doesn't have a built-in down-migration system — we treat migrations as one-way. If a migration broke something:

### If the migration is ADDITIVE (added column / index)
- Don't roll back; just deploy a code fix that handles the new column gracefully.
- Risk: zero if the code rollback (Section A) doesn't read the new column.

### If the migration is DESTRUCTIVE (dropped column / changed type)
You need a manual reverse migration. **THIS IS SLOW AND RISKY** — only do this if the migration is causing data loss right now.

```sql
-- Connect via psql to production Postgres (via Hyperdrive bypass —
-- direct connection, not via worker)
PGPASSWORD=<...> psql -h <prod-pg> -U aster_admin -d aster_cloud

-- 1. Take a snapshot first
\! pg_dump -h <prod-pg> -U aster_admin aster_cloud > /tmp/pre-revert-$(date +%s).sql

-- 2. Find the offending migration
SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;

-- 3. Hand-write the inverse SQL (e.g. ADD COLUMN if it was DROPPED).
--    DO NOT delete the row from __drizzle_migrations — that lies to
--    drizzle and the next migration won't know about your changes.
--    Instead, leave the migration row alone and just rebuild the
--    affected schema by hand.

-- 4. Tell drizzle to "skip" the next normal migration run by
--    writing the snapshot:
\! pnpm db:generate    # generates a no-op migration acknowledging current state
git add drizzle/
git commit -m "migration: post-rollback schema reconciliation"
```

**Caveats**:
- This is the slowest path; expect 5-15 min from "start" to "verified".
- Hyperdrive connections need to be re-established after schema changes — `wrangler hyperdrive` may need re-deploy.
- Customer impact during this window is severe; communicate accordingly.

## D. Check before rolling back migrations

90% of "migration broke prod" is actually "code broke prod, migration is fine". Verify before rolling back:

```bash
# Does the new schema work with the OLD code?
KUBECONFIG=~/.kube/k3s-config kubectl -n aster-cloud rollout undo deploy/aster-api
# If this restores service: migration is fine, code was bad → revert code, leave DB
# If this DOESN'T restore service: migration is destructive → Section C
```

## What to NOT roll back

- **NextAuth sessions**: rolling back AUTH_SECRET invalidates all sessions globally. Don't unless the secret leaked.
- **Stripe webhooks**: rolling back STRIPE_WEBHOOK_SECRET disconnects Stripe → subscription state goes stale. Customer-visible billing pain.
- **License key**: on-prem customers' LICENSE_KEY env is THEIR responsibility, not ours.

## Post-rollback checklist

- [ ] Verify recovery on multiple endpoints (health, dashboard, an authenticated route)
- [ ] Watch metrics for 30 min — relapse is real
- [ ] Update status page → "Resolved"
- [ ] Post final summary in #incident channel
- [ ] File post-mortem within 72h via [`post-mortem-template.md`](post-mortem-template.md)
- [ ] Identify why the bad commit got past CI/staging — fix that gap

## Practice this

Rollback procedures atrophy. **Quarterly**:
- One on-call practices Section A against staging (no production impact)
- One practices Section B against the staging ArgoCD app
- Section C is too risky to practice in prod; document the procedure and verify the steps still match current schema reality
