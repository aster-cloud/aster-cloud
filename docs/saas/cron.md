# Cron jobs — dual-trigger model with Postgres dedup

The SaaS Worker schedules five cron jobs through Cloudflare's
`[triggers]` block in `wrangler.toml`. Every job is also invokable as
a regular HTTP route (`POST /api/cron/<job>` with the `CRON_SECRET`
bearer), so ops or a GitHub Actions runner can fire the same job
ad-hoc. The two trigger paths can race; a Postgres lease serializes
them so the work runs at most once per scheduled window.

This document is the contract for adding, deduping, and observing
cron jobs. The pre-V2 history was that the `[triggers]` block was
unwired — Cloudflare fired events with no handler.

## Architecture

```
        ┌─────────────────────┐
        │ Cloudflare scheduler│  ← wrangler.toml [triggers].crons
        └──────────┬──────────┘
                   │ event.cron + event.scheduledTime
                   ▼
        ┌─────────────────────┐
        │  worker.js          │  ← scheduled(event, env, ctx)
        │  CRON_DISPATCH map  │
        └──────────┬──────────┘
                   │ POST <route>  Bearer CRON_SECRET
                   │ + x-cron-source: worker-scheduled
                   │ + x-cron-window-start: <ISO>
                   ▼
   ┌──────────────────────────────────────────┐
   │  /api/cron/<job>/route.ts                │
   │   1. requireCronAuth(req)                │
   │   2. parseCronWindow(req, jobName)       │
   │   3. runCronOnce(jobName, fn, opts)      │
   │      ├─ acquire lease  (DB UNIQUE)       │
   │      ├─ run fn         (or skip)         │
   │      └─ mark done/failed                 │
   │   4. return JSON                         │
   └──────────────────────────────────────────┘

   ▲                              ▲
   │                              │
   │ external curl / GH Actions   │ same route, same path
   │ POST <route> Bearer CRON_SECRET
   │ (no headers → registry computes window)
```

## Registry — single source of truth

`src/lib/cron-registry.ts` declares every scheduled cron. Each entry
has `(jobName, cron, routePath, windowStartFor)`. The `windowStartFor`
function maps "now" to the canonical boundary for that schedule
(e.g. 04:30 UTC for `30 4 * * *`). Two callers in the same bucket
produce the same window-start, which is what the lease keys on.

The Cloudflare-side mirror lives in `worker.js` as a plain object
literal because the Worker entrypoint can't import `src/`. A unit
test (`cron-registry-worker-sync.test.ts`) refuses CI if the two
drift.

## Lease semantics

`CronJobLease` table:

| column | type | role |
|---|---|---|
| `id` | text PK | uuid |
| `job_name` | text | matches `CronJob.jobName` |
| `window_start` | timestamptz | canonical boundary |
| `acquired_at` | timestamptz | now() |
| `acquired_by` | text | `'worker-scheduled'` / `'http-external'` / `'integration-test'` |
| `completed_at` | timestamptz | set on done/failed |
| `status` | enum | `'running'` → `'done'` \| `'failed'` |
| `error_message` | text | truncated to 500 chars on failure |

`UNIQUE (job_name, window_start)` + `INSERT … ON CONFLICT DO NOTHING`
gives first-writer-wins atomicity at the DB layer. We don't need a
distributed lock service.

## How to add a new cron

1. **Pick a schedule** that doesn't collide with the cron field's
   reading of "today's window". Avoid `* * * * *` — windows must be
   well-defined intervals (daily, hourly bucket, weekly).
2. **Add an entry to `CRON_REGISTRY`** in
   `src/lib/cron-registry.ts` with `windowStartFor` computing the
   canonical window-start for that schedule.
3. **Mirror in `worker.js`**: add `"<cron>": "<routePath>"` to the
   `CRON_DISPATCH` object. The sync test enforces parity.
4. **Add the cron expression** to the `crons = [...]` array in
   `wrangler.toml`'s `[triggers]` block.
5. **Wrap the route body** in `runCronOnce`:

   ```ts
   export async function POST(req: NextRequest) {
     const guard = requireCronAuth(req);
     if (guard) return guard;
     const { acquiredBy, windowStart } = parseCronWindow(req, 'your-job-name');
     const outcome = await runCronOnce(
       'your-job-name',
       async () => { /* the actual work */ return result; },
       { acquiredBy, windowStart },
     );
     if (!outcome.ran) {
       return NextResponse.json({
         skipped: true,
         reason: outcome.skippedReason,
         windowStart: outcome.windowStart,
       });
     }
     return NextResponse.json({ ...outcome.result, windowStart: outcome.windowStart });
   }
   ```

6. **Deploy** — `wrangler deploy`. Cloudflare picks up the new cron
   on next deploy reconciliation.

## Manual invocation (ops / GitHub Actions)

```sh
# Fire today's window from outside Cloudflare. The route computes
# the canonical window-start from the registry, so two ops curls
# 30s apart end up sharing one lease.
curl -sS -X POST https://aster-lang.cloud/api/cron/telemetry-retention-gc \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "x-cron-source: ops-curl"
```

If you need to backfill a *specific* prior window:

```sh
curl -sS -X POST https://aster-lang.cloud/api/cron/telemetry-retention-gc \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "x-cron-source: ops-backfill" \
  -H "x-cron-window-start: 2026-05-10T03:15:00.000Z"
```

The `x-cron-window-start` header overrides the registry computation —
useful for replaying a window that failed (lease will be `'failed'` so
your backfill won't run; clear the row first or pick a different window).

## Observability

Lease rows are the source of truth for "did the 04:30 user-purge
happen?". Query examples:

```sql
-- Latest 50 cron executions across all jobs
SELECT job_name, window_start, status, acquired_by, error_message
  FROM "CronJobLease"
 ORDER BY acquired_at DESC
 LIMIT 50;

-- Jobs that haven't run in the last 25 hours (alert candidate)
SELECT job_name, MAX(acquired_at) AS last_run
  FROM "CronJobLease"
 WHERE status = 'done'
 GROUP BY job_name
HAVING MAX(acquired_at) < now() - interval '25 hours';

-- Failed runs in the last week
SELECT job_name, window_start, error_message
  FROM "CronJobLease"
 WHERE status = 'failed' AND acquired_at > now() - interval '7 days'
 ORDER BY acquired_at DESC;
```

## Test seams

- **Unit tests**: route-handler unit tests stub `db` and don't know
  about the lease layer. The `BYPASS_CRON_LEASE=1` env (set globally
  in `vitest.config.ts`) makes `runCronOnce` execute the inner
  function directly. Production never reads this env.
- **Integration tests**: `src/__tests__/integration/cron-lease.saas.integration.test.ts`
  exercises the real DB path — concurrency, error propagation,
  registry guard.
- **Sync test**: `src/__tests__/lib/cron-registry-worker-sync.test.ts`
  fails CI if `worker.js`'s `CRON_DISPATCH` diverges from
  `CRON_REGISTRY`.
