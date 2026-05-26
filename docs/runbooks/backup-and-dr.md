# Backup + Disaster Recovery (DR)

Strategy, schedules, recovery procedures, and the quarterly drill. Covers prod SaaS (Cloudflare + Hyperdrive-fronted Postgres) and staging (OCI K3S + CNPG).

## Recovery targets

| Metric | Definition | Target (prod) | Target (staging) |
|---|---|---|---|
| **RPO** | Recovery point objective — max acceptable data loss | ≤ 5 min | ≤ 1 hour |
| **RTO** | Recovery time objective — max acceptable downtime | ≤ 30 min | ≤ 2 hours |
| **MTBF** | Mean time between failures (informational, not a target) | n/a | n/a |

Why prod is tighter: paying customers, billing-affecting data, the SLO error budget.

## What gets backed up

### Production SaaS

| Data | Mechanism | Frequency | Retention | Destination |
|---|---|---|---|---|
| Postgres (Hyperdrive primary) | Provider's continuous backup (Neon / Supabase / similar) | continuous WAL | 30 days | Provider-managed |
| Postgres logical export | `pg_dump` via worker cron | daily 14:00 UTC | 90 days | Cloudflare R2 `aster-prod-pg-backups` |
| Cloudflare R2 buckets | R2 versioning (built-in) | per-write | 30 days | R2 itself |
| Cloudflare KV (session, rate-limit) | NOT backed up (ephemeral) | — | — | — |
| Stripe webhook history | Stripe stores 30 days; we mirror to D1 ledger | per-event | indefinite (ledger never deletes) | D1 `webhook_ledger` table |
| AI key bindings (encrypted) | pg_dump above covers | daily | 90 days | R2 |
| Audit log | Postgres table; covered by pg_dump | daily | 1 year (compliance) | R2 + cold storage after 90 days |

### Staging (OCI K3S)

| Data | Mechanism | Frequency | Retention | Destination |
|---|---|---|---|---|
| Postgres (CNPG) | barman-cloud WAL backup | every 5s (WAL) | 30 days | OCI Object Storage `bucket-backup` |
| Postgres full snapshot | CNPG `ScheduledBackup` | daily 14:00 UTC | 30 days | OCI Object Storage `bucket-backup` |
| K8s manifests | Git (source of truth) | per-commit | forever | GitHub |
| Secrets (Vault) | OCI Vault native backup | continuous | 1 year | OCI-managed |

### NOT backed up (intentional)

- **NextAuth sessions** — ephemeral; users re-login
- **CSRF tokens, rate-limit counters** — recoverable on next request
- **Cloudflare Worker code** — Git is the source of truth; `wrangler deploy` re-creates
- **Customer's on-prem clusters** — that's their responsibility per the on-prem contract
- **Container images** — Docker Hub + ghcr.io are the source; CI re-pushes if needed

## Backup verification

A backup that's never restored is not a backup. We verify:

### Monthly (automated)

- `scripts/verify-prod-backup.ts` runs as a cron Worker on the 1st of each month
- Downloads the latest R2 `pg_dump`, spins up a throwaway Postgres pod, restores, runs `SELECT count(*) FROM organizations` and other smoke checks
- Alerts Slack `#alerts-prod` on failure

### Quarterly (manual — see DR drill below)

Full restore-to-recovery exercise, including the OCI ATP cold-standby for staging.

## Disaster scenarios + recovery procedures

### Scenario 1: Single Cloudflare Worker error (deploy regression)

**Severity**: P1
**RPO/RTO**: 0 min RPO (no data lost), <2 min RTO
**Procedure**: `wrangler rollback` — see `rollback.md` Section A.

### Scenario 2: Postgres primary corruption (Hyperdrive backend)

**Severity**: P0
**RPO**: ≤ 5 min (provider WAL granularity)
**RTO**: 30-60 min depending on provider

Procedure:
1. Page Postgres provider (Neon/Supabase) immediately — they have hot-standby tools we don't
2. Switch Hyperdrive binding to provider's PITR endpoint (`wrangler hyperdrive update`)
3. Verify reads from staging using `wrangler tail`
4. Lift the read-only banner once writes verify

### Scenario 3: Cloudflare account compromise

**Severity**: P0
**RPO**: depends on attacker capability
**RTO**: hours (DNS migration)

Procedure:
1. Page CF support + revoke all API tokens
2. Spin up emergency deploy on OCI staging cluster (Section "Emergency promotion of staging to prod")
3. Update DNS to point apex `aster-lang.cloud` to the OCI cluster
4. Communicate widely — this is a recovery situation, not just an outage
5. Once CF is contained, plan migration back

### Scenario 4: Entire OCI staging region (ap-melbourne-1) outage

**Severity**: P2 (staging is non-critical)
**RPO**: ≤ 1 hour (WAL retention to Object Storage)
**RTO**: 2-4 hours

Procedure:
1. Confirm via OCI status page that it's a region-wide event
2. If active customer POC, communicate that staging is down
3. Spin up ATP instance in same region (within-AD failover usually works)
4. Follow `deploy/staging/postgres/dr-autonomous-db.md` restore procedure
5. Update DNS once recovered

### Scenario 5: Drizzle migration ate production data

**Severity**: P0
**RPO**: as recent as last backup before migration ran (worst case 24h)
**RTO**: 1-3 hours

Procedure:
1. STOP all writes IMMEDIATELY — engage emergency disable (network scope) per `emergency-disable.md`
2. Identify the bad migration: `SELECT * FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 5;`
3. Take a snapshot of current (broken) state for forensics: `pg_dump > /tmp/broken-$(date +%s).sql`
4. Restore the most recent pre-migration `pg_dump` from R2
5. Replay any application-level data that landed AFTER the migration but is recoverable from event logs (Stripe, webhook ledger, audit log)
6. Re-enable network access
7. Write the post-mortem — this is a "fundamental gap" class incident

## Quarterly DR drill (mandatory)

### Schedule

- **Q1**: First Wednesday of February
- **Q2**: First Wednesday of May
- **Q3**: First Wednesday of August
- **Q4**: First Wednesday of November

Time-block 4 hours. Notify customers if drill touches production-adjacent systems (it usually does not).

### Drill procedure

1. **Planning (1 week before)**
   - On-call lead picks one DR scenario from the list above
   - Drafts a one-page drill plan
   - Posts to `#ops` with the scenario + expected procedures
   - Books the calendar slot

2. **Day-of (T - 1 hour)**
   - Stand up the drill instance (e.g., ATP from cold standby)
   - Have the runbook open
   - Set a timer

3. **Execution**
   - Walk through the recovery steps EXACTLY as written
   - Note every place the runbook diverges from reality
   - Note timestamps for each phase to compare with RTO target

4. **Post-drill (within 48h)**
   - Update runbooks for any drift
   - File issues for any tooling gaps discovered
   - Post a one-page summary in `#ops`: "DR drill 2026-Q2 — Scenario 4 — RTO target 2h, actual 1h47m — 2 docs updated, 1 new tool needed"

### Drill failure handling

If the drill blows past RTO by 2x, that's a P2 ticket. Triage:
- Is the runbook wrong? → fix it
- Is a tool missing? → build it
- Is the human procedure too complex? → automate

## Emergency promotion of staging to prod

This is a **break-glass** procedure for total prod compromise. Only the head of engineering may authorize.

Outline:
1. Update DNS A record for `aster-lang.cloud` from Cloudflare LB → OCI K3S LB IP
2. Deploy aster-cloud + aster-api Helm charts with prod-like config (Vault key `secret/apps/aster-cloud-prod-emergency`)
3. Restore latest prod Postgres `pg_dump` from R2 into the staging CNPG (overwrites staging data — accept this)
4. Verify smoke tests
5. Communicate
6. Plan migration back to Cloudflare once incident resolved

**Don't practice this in earnest**; it's high-risk. Document the procedure (here), verify each individual step works in isolation during quarterly drills.

## Backup costs

| Item | Approx monthly cost |
|---|---|
| Cloudflare R2 (pg_dump + audit) | $5 |
| OCI Object Storage (staging WAL + snapshots) | $5 |
| OCI ATP cold standby (1 TB, paused) | $30 |
| Postgres provider WAL retention (included in plan) | $0 |
| **Total** | **~$40/mo** |

Cheap insurance. Re-evaluate at 10k MAU when prod RPO targets may tighten.

## Related

- `rollback.md` — fast rollback (under 5 min)
- `incident-response.md` — incident protocol
- `deploy/staging/postgres/dr-autonomous-db.md` — ATP cold-standby details
- `emergency-disable.md` — break-glass shutdowns
- `secrets-rotation.md` — credentials needed during recovery
