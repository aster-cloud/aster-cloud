# Incident response runbook

Six scenarios that on-call must handle in under 15 minutes. Each follows the same structure:

1. **Detection signal** — what alert / dashboard / customer report indicates this scenario
2. **5-min response** — stop the bleeding (rollback, disable, scale)
3. **Diagnosis** — narrow down root cause
4. **Recovery** — restore service
5. **Post-incident** — what to capture for the post-mortem

If on-call is unsure which scenario applies: **default to scenario 1 (Worker down)** because it has the highest blast radius and the quickest mitigation.

---

## Scenario 1 — Cloudflare Worker not serving traffic

### Detection
- Pingdom / uptime monitor on `https://aster-lang.cloud/` reports DOWN
- 5xx rate on the Cloudflare Workers dashboard spikes >10%
- Multiple "site is down" reports in #support
- Synthetic check `/api/health` from external pinger fails

### 5-min response (stop bleeding)
```bash
# 1. Check whether it's a config rollback we can do immediately
wrangler deployments list --name aster-cloud | head -5
# If the last successful deploy is identifiable, roll back:
wrangler rollback --message "incident: 5xx spike post-deploy"

# 2. While that's running, status page:
#    https://status.aster-lang.cloud/ → "Investigating issues with the
#    web app". Don't promise an ETA until step 3 finishes.
```

### Diagnosis
- Cloudflare Workers logs (`wrangler tail aster-cloud --format pretty`) — look for stack traces in the last 5 min
- Hyperdrive dashboard — Postgres connection failures?
- Check `aster-api` health: `curl -sI https://policy.aster-lang.dev/q/health`
- Status: cloudflare.statuspage.io for Workers/Hyperdrive outage

### Recovery
- If config rollback succeeded → wait for next deploy cycle to verify; status page → resolved
- If Hyperdrive issue → contact Cloudflare support; staging on OCI is the failover path
- If Worker code issue → rollback persists, file post-mortem for the bad commit

### Post-incident
- Worker logs from incident window (export via `wrangler tail -t 30m > incident.log`)
- Deployment timeline from Cloudflare dashboard
- Customer impact estimate (5xx count × affected unique IPs)

---

## Scenario 2 — Postgres unreachable / DB connection saturated

### Detection
- API responses return 503 `service_unavailable` envelope with code `db_unreachable`
- Hyperdrive connection-pool exhausted alert (Cloudflare dashboard)
- `wrangler tail` shows `Connection terminated unexpectedly` clustering

### 5-min response
```bash
# 1. Status page: degraded (not down — read paths still work via cache)

# 2. Inspect connection pool stats:
curl -sH "Authorization: Bearer $CF_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$ACCT/hyperdrive/configs/$HYPERDRIVE_ID/health"

# 3. If connections are pinned: bump Hyperdrive pool size temporarily
wrangler hyperdrive update $HYPERDRIVE_ID \
  --max-connections 200   # default is 100; doubles temporarily
```

### Diagnosis
- Postgres-side: check the OCI Autonomous DB metrics (active sessions, lock wait time)
- Cloudflare-side: Hyperdrive pool wait time spikes
- Any long-running transactions? `psql -c "SELECT pid, state, query_start, query FROM pg_stat_activity WHERE state != 'idle' ORDER BY query_start;"`
- Recent migration that took a lock? Check `drizzle/` recent files

### Recovery
- Kill the offending long-running query if any (`pg_terminate_backend(pid)`)
- If pool exhaustion isn't a leak but real load → scale Hyperdrive permanently
- If migration is the cause → roll back migration via `drizzle-kit migrate down`

### Post-incident
- pg_stat_activity snapshot during incident
- Hyperdrive metrics graph
- Whether autoscaling could have prevented this (cost analysis)

---

## Scenario 3 — License expired in production (on-prem customer)

### Detection
- On-prem customer reports `/admin` is in read-only mode
- Grafana dashboard panel "Read-only gate trigger rate" spikes on `reason=expired`
- License Days Remaining stat hit 0
- Email from customer to support: "all admin operations rejected"

### 5-min response
This is a **customer-side issue**, not an Aster outage. Standard response:

```
1. Confirm with the customer that admin/* read-only banner is showing
2. Check internal license registry — is this customer's license actually expired?
3. If YES → sales/renewal team takes over; this is now a billing/contract issue
4. If NO → the customer's deployment has a clock skew or stale license; debug.
```

### Diagnosis
- Was a renewed license issued but not deployed by the customer?
- Is `ASTER_DEPLOYMENT_ID` env set correctly on their pod?
- Is their Cloudflare→Aster outbound traffic blocked? (revocation refresh fails → eventual grace-expired)
- Verify in customer's Grafana: which `reason` is the read-only gate firing on?
  - `expired` → license is actually expired; need renewal
  - `grace-expired` → revocation endpoint unreachable for 7+ days; network issue
  - `clock-rollback` → host system clock went backwards; NTP issue
  - `revoked` → license was deliberately revoked by Aster (sales decision)
  - `binding-mismatch` → license bound to a different deployment; wrong key

### Recovery
- Re-issue license via license-key-ceremony procedure (see [`license-key-ceremony-rehearsal.md`](license-key-ceremony-rehearsal.md))
- Customer deploys new `LICENSE_KEY` env value → admin returns to active

### Post-incident
- Was customer notified by renewal cron at 30/14/7/1 day thresholds? If not, fix the cron.
- Add the customer to expiring-soon dashboard so we have proactive visibility

---

## Scenario 4 — AI API quota exhausted (BYOK or platform pool)

### Detection
- `/api/llm/*` endpoints return 503 with code `ai_circuit_breaker_open`
- AI Circuit Breaker dashboard shows "OPEN" state
- AI usage spike on a single tenant or globally

### 5-min response
```bash
# 1. Determine scope: single tenant or platform-wide?
psql "$DATABASE_URL" -c "
  SELECT user_id, COUNT(*) AS calls, SUM(token_count) AS tokens
  FROM \"AiUsageRecord\"
  WHERE created_at > NOW() - INTERVAL '1 hour'
  GROUP BY user_id ORDER BY tokens DESC LIMIT 10;
"

# 2. If single abusive tenant:
#    a. Disable their BYOK key (force them off platform pool):
psql -c "UPDATE \"AiKeyBinding\" SET active=false WHERE \"userId\"='abuser';"
#    b. Block the user (emergency-disable runbook):
#       see docs/runbooks/emergency-disable.md
# 3. If platform-wide:
#    Open the circuit breaker manually via /admin/ai-circuit-breaker
```

### Diagnosis
- AI provider (OpenAI / Anthropic) status pages
- Which provider is the hot one? `AiUsageRecord.provider` breakdown
- Is this scraping/abuse, or a legitimate customer doing something new?

### Recovery
- If provider outage: switch BYOK to alternate provider in /admin/ai-circuit-breaker
- If quota issue with own platform pool: upgrade the relevant OpenAI/Anthropic billing tier
- If abuse: ban the actor; the AI circuit breaker auto-closes after `circuit-cooldown` (5 min default)

### Post-incident
- Token spend during incident window
- Source of the burst (single user / API key / IP)
- Update rate-limit thresholds if necessary

---

## Scenario 5 — BYOK encryption secret rotation gone wrong

### Detection
- After running `rotate-byok-encryption-secret.ts`, customer reports "AI features don't work"
- Worker logs: `pgp_sym_decrypt: error: wrong key or corrupt data`
- Specific `AiKeyBinding.id` failing decrypts

### 5-min response
**Stop further damage**: revert the Worker's `AI_KEY_ENCRYPTION_SECRET` to the old value via `wrangler secret put` (using your 1Password copy of the previous value).

```bash
echo "$OLD_SECRET" | wrangler secret put AI_KEY_ENCRYPTION_SECRET --name aster-cloud
wrangler deploy --name aster-cloud
```

### Diagnosis
- Read the checkpoint file `/tmp/byok-rotation-progress.json` to see which rows completed
- If checkpoint says "100 done, 50 remaining" but Worker is on NEW secret: those 100 work, those 50 are broken
- Affected count = remaining rows from checkpoint

### Recovery
- With Worker reverted to OLD secret, the 100 NEW-encrypted rows are now broken
- Re-run rotation script with OLD and NEW **swapped** to undo those 100 → all rows back to OLD secret
- Investigate why script crashed (often: DB connection drop, schema drift); fix; retry rotation
- See [`secrets-rotation.md`](secrets-rotation.md) "Rollback" section for details

### Post-incident
- Why did the script crash mid-rotation?
- Are checkpoint writes atomic? (yes, but verify with file timestamps)
- Customer comms: tell affected customers what happened, that no key material leaked

---

## Scenario 6 — `/evaluate-source` OOM cascade

### Detection
- aster-api pods OOMing (K3S `kubectl get pods` shows `OOMKilled` status)
- /evaluate-source 503 rate spikes (semaphore rejecting)
- Pingdom on `aster-api` health endpoint flaps

### 5-min response
```bash
# 1. Scale the deployment up to absorb the burst:
kubectl -n aster-cloud scale deploy/aster-api --replicas=4

# 2. If sustained, lower the semaphore + thread pool:
kubectl -n aster-cloud set env deploy/aster-api \
  ASTER_EVAL_SOURCE_SEMAPHORE_PERMITS=2 \
  QUARKUS_THREAD_POOL_MAX_THREADS=8

# 3. Verify pods stop OOMing:
kubectl -n aster-cloud get pods -w
```

### Diagnosis
- Who's hitting /evaluate-source? Marketing playground? Dashboard preview?
- Check Grafana request-rate panel by tenant
- Is the marketing trial endpoint being abused? Check TrialEndpointGuard logs

### Recovery
- If abuse: tighten `aster.security.trial.per-ip.minute-max` env
- If legitimate growth: keep the scaled replica count, plan a CPU upgrade
- If OOM root cause is a runaway policy source (large CNL document): tighten `aster.security.trial.max-body-bytes`

### Post-incident
- Peak in-flight count from `aster_eval_source_in_flight_gauge`
- OOM trigger time vs scale-up time (latency between detection and response)
- Whether the docs/perf/ baseline still holds under current spike pattern

---

## Cross-cutting practices

### Always
- File post-mortem via [`post-mortem-template.md`](post-mortem-template.md) within 72 hours
- Update status page in real-time (don't go silent)
- Keep a personal incident log: timestamp every action you take
- If something feels wrong, page the secondary on-call. There's no medal for solo heroism

### Never
- Modify production secrets without 1Password backup
- Force-push to main during an incident
- Disable a customer without a paper trail (use admin API endpoints that audit-log)
- Promise a fix ETA you can't keep
- Stop monitoring after the fix — watch for relapse for 30+ minutes

### Communication template

Post to #incident-${ID} every 15 minutes during active incident:

```
[14:32] Detected 5xx spike (8% error rate) on aster-lang.cloud
[14:34] Confirmed Cloudflare Workers deployment from 14:28 introduced
[14:36] Initiated wrangler rollback to previous deploy
[14:39] Rollback complete; 5xx rate normalizing
[14:45] Recovery confirmed; status page → resolved
[14:48] Post-mortem assigned to <person>; PR-blame on commit abc123
```
