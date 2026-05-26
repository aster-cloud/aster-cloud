# GA Readiness Checklist

The master roll-up of everything that must be true before we declare General Availability and start signing paid contracts. Each item points to the runbook, doc, or commit that proves it.

**GA target date**: 2026-Q3 (tentative; gated on this checklist hitting 100%)

**Owner**: head of engineering (sign-off authority)

**Last reviewed**: 2026-05-26

---

## Status legend

- ✅ Done
- 🟡 In progress
- ⬜ Not started
- 🔴 Blocked

---

## Phase 1: Engineering Hygiene

### CI/CD
- ✅ Build + unit test on PR — `.github/workflows/ci.yml`
- ✅ E2E test job (server boot + Playwright against http://localhost:3001) — same workflow
- ✅ Performance regression CI (k6, nightly) — `.github/workflows/perf.yml` + `perf/{evaluate,evaluate-source}.js`
- ✅ Dependabot (weekly Mondays Australia/Melbourne, grouped) — `.github/dependabot.yml`
- ✅ Changelog automation (git-cliff on push to main, [skip ci] loop-breaker) — `.github/workflows/changelog.yml` + `cliff.toml`

### Code quality
- ✅ TypeScript strict mode on `aster-cloud`
- ✅ ESLint blocks on PR
- ✅ Golden tests for parser, validator, planner
- ✅ Zero hardcoded zh strings in production paths — last sweep 2026-05-25
- ✅ Bundle size budget (`size-limit` config — re-verify before GA)

---

## Phase 2: Security

### Application security
- ✅ AUTH_SECRET, CRON_SECRET, ASTER_PLAN_GATE_HMAC_KEY, AI_KEY_ENCRYPTION_SECRET stored in Vault / Wrangler secrets
- ✅ License key flow hardened (4 fixes May 2026: NODE_ENV=production veto, fingerprint cross-check, clock-rollback detection, --out-file 0600)
- ✅ Owasp ZAP authenticated scan on PR — `.github/workflows/security-scan.yml` + `.github/zap/`
- ✅ Secrets rotation runbook + BYOK re-encryption script — `docs/runbooks/secrets-rotation.md`
- ✅ DSAR self-service E2E test — `src/__tests__/e2e/dsar-self-service.e2e.test.ts`
- ✅ License-key ceremony rehearsal runbook — `docs/runbooks/license-key-ceremony-rehearsal.md`
- ⬜ External penetration test (vendor TBD; book before GA; budget ~$15k)

### Resource safety
- ✅ `/evaluate-source` worker-pool heap-aware cap (low-heap warning + 503 fast-fail) — `9fdba68`, `11034aa`, `161de01`, `af198d6`
- ✅ Quarkus thread-pool bounds — `application.properties` `QUARKUS_THREAD_POOL_MAX_THREADS`
- ✅ ApiQuotaGuard short-circuit (cached check) — load-test fix
- ✅ Semaphore-based concurrency limiting on hot endpoints

### Observability for security
- ✅ Clock-rollback Grafana panel — `docs/on-prem/grafana-license-dashboard.json` Panel 8
- ✅ Trust bundle assertion failure panel — same dashboard Panel 10
- ✅ Read-only gate trigger rate — same dashboard Panel 7

---

## Phase 3: Operations

### Runbooks (all in `docs/runbooks/`)
- ✅ `incident-response.md` — 6 scenarios with detect/respond/diagnose
- ✅ `post-mortem-template.md` — blameless SRE format
- ✅ `on-call.md` — rotation, severity tiers, handoff
- ✅ `rollback.md` — 5-min rollback for 3 surfaces
- ✅ `emergency-disable.md` — user/tenant/network/kill-switch
- ✅ `secrets-rotation.md` — full credential inventory + procedures
- ✅ `license-key-ceremony-rehearsal.md` — quarterly dry-run
- ✅ `staging-deploy.md` — staging deploy + invite + reset
- ✅ `backup-and-dr.md` — strategy + DR drill schedule

### Process
- ✅ On-call rotation defined (1 week primary + 1 secondary + head-of-eng escalation)
- ⬜ PagerDuty service `aster-prod-saas` configured with escalation policy
- ⬜ #alerts-prod Slack channel routed from Pingdom + Healthchecks
- ⬜ Status page (`status.aster-lang.cloud`) live
- ⬜ Customer-facing security contact email + PGP key published
- ⬜ Quarterly DR drill scheduled (next: 2026-08 first Wed)

---

## Phase 4: Monitoring & SLOs

### SLO definitions (`docs/operations/`)
- ✅ `slo.md` — SLOs A1-A7 (dashboard avail, /evaluate p99, /evaluate-source p99, login, write-success, Stripe idempotency, revocation refresh)
- ✅ Multi-window burn-rate alerting formulas

### Uptime monitoring (`docs/operations/uptime-monitoring.md`)
- ✅ Spec for 6 Pingdom HTTP synthetic checks
- ✅ Spec for 11 Healthchecks.io cron heartbeats
- ⬜ Pingdom account provisioned + checks live
- ⬜ Healthchecks.io account provisioned + check URLs distributed via env
- ⬜ Each cron route updated to call `recordHealthcheckHeartbeat()` at start + finish

### Dashboards
- ✅ License dashboard (`docs/on-prem/grafana-license-dashboard.json`) — 10 panels
- ⬜ SaaS overview dashboard (request rate, p99 latency, error rate, active orgs)
- ⬜ AI usage dashboard (per-provider token consumption, cache hit rate, circuit-breaker state)

---

## Phase 5: Staging Environment

All in `deploy/staging/` — single source of truth managed by ArgoCD.

- ✅ Helm chart for aster-cloud (Next.js Deployment + Service + Ingress + ExternalSecret + ConfigMap)
- ✅ Helm chart for aster-api (Quarkus Deployment + Service + ExternalSecret with thread-pool bounds)
- ✅ CNPG Postgres cluster (3 instances, WAL backup to OCI Object Storage `bucket-backup`)
- ✅ Daily ScheduledBackup at 14:00 UTC (00:00 AEST)
- ✅ OCI Autonomous DB cold-standby for catastrophic recovery (`deploy/staging/postgres/dr-autonomous-db.md`)
- ✅ ArgoCD Application manifest (3 apps: aster-cloud-staging, aster-api-staging, postgres-staging)
- ✅ Cloudflare DNS A record (DNS-only) for staging.aster-lang.cloud → K3S LB IP
- ✅ cert-manager Let's Encrypt TLS via Traefik ingress annotation
- ⬜ Initial deploy verified (ArgoCD sync green)
- ⬜ First customer POC invited + onboarded successfully

---

## Phase 6: Architecture & DR

- ✅ ADR-0007 — Per-tenant license keys (proposed; design only)
- ✅ Backup + DR runbook (`docs/runbooks/backup-and-dr.md`)
- ⬜ Quarterly DR drill executed once (proves the runbook works)
- ⬜ Emergency staging-to-prod promotion procedure verified (read-through only; do not exercise in earnest)

---

## Phase 7: Business + Legal (NOT software gating; tracking)

These are not blocked by engineering but must align before GA.

- ⬜ Terms of Service + Privacy Policy reviewed by counsel
- ⬜ DPA template ready for customer signature
- ⬜ Stripe billing integration verified end-to-end (subscription create / cancel / dunning / refund)
- ⬜ Pricing page finalized
- ⬜ Support response SLA defined (e.g., P1 ack in 4 business hours)
- ⬜ Customer onboarding playbook (first 30 days, success metrics)

---

## Sign-off

GA cannot be declared until:

1. **All ✅/⬜ items above are ✅** OR have a documented "accept the risk" exception signed by head of eng
2. **One full quarterly DR drill executed** with documented results
3. **Three consecutive months of SLO targets met** (gives the system + monitoring + runbooks a chance to mature)
4. **At least one paying customer in production with no P0/P1 incidents in the prior 30 days**

Sign-off path:
```
Head of Engineering (technical readiness)
        ↓
CEO / founder (business + customer readiness)
        ↓
Publicly declare GA via blog post + status page
```

## Risks + open items

| Risk | Severity | Owner | Mitigation |
|---|---|---|---|
| External pentest hasn't happened | High | Head of eng | Book vendor by 2026-06-15 |
| Quarterly DR drill never exercised | High | On-call lead | Schedule next drill 2026-08-05 |
| PagerDuty config not yet live | Medium | Ops | Provision before first customer goes live |
| No production observability dashboard yet (only on-prem one) | Medium | Eng | Build SaaS overview dashboard in next sprint |
| Per-tenant license keys (ADR-0007) is a 6-month project, not in GA scope | Low | License stewards | Document the gap; revisit post-GA |

## Related

- `docs/architecture/decisions/` — ADRs 0001 through 0007
- `docs/runbooks/` — all operational procedures
- `docs/operations/` — SLOs and monitoring specs
- `deploy/staging/` — staging environment as code
- `.github/workflows/` — CI / CD / security / perf pipelines
