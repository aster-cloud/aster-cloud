// Custom Worker entrypoint — wraps the OpenNext-generated handler and
// adds a `scheduled()` handler so Cloudflare cron triggers actually
// fire something. Without this `scheduled()`, the `[triggers]` block
// in `wrangler.toml` schedules events with no listener and they
// silently no-op.
//
// Design notes:
//   - The TypeScript source of truth for which cron expression maps
//     to which route lives in `src/lib/cron-registry.ts`. We mirror
//     the cron→route mapping here as a static object because this
//     entrypoint can't import from src/ (OpenNext bundles Next routes
//     separately). `src/__tests__/lib/cron-registry-worker-sync.test.ts`
//     enforces the two stay in lockstep.
//   - Idempotency lives in the route layer (runCronOnce in
//     src/lib/cron-lease.ts), not here. The dispatcher is intentionally
//     "fire and forget at HTTP level"; whichever caller wins the
//     Postgres lease executes, others 200 with skipped=true.

// 动态导入 OpenNext 生成的 worker
import openNextWorker from "./.open-next/worker.js";

// 重新导出 OpenNext 的 Durable Objects
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

// Mirror of CRON_REGISTRY in src/lib/cron-registry.ts. Keep in sync.
// Tested by src/__tests__/lib/cron-registry-worker-sync.test.ts.
const CRON_DISPATCH = {
  "30 4 * * *": "/api/cron/user-purge",
  "0 5 * * *": "/api/cron/risk-tier-decay",
  "0 */6 * * *": "/api/cron/license-revocation-refresh",
  "0 8 * * 1": "/api/cron/license-renewal-warning",
  "15 3 * * *": "/api/cron/telemetry-retention-gc",
};

async function dispatchCron(event, env, ctx) {
  const route = CRON_DISPATCH[event.cron];
  if (!route) {
    // Cloudflare fired a cron expression we don't know about. Likely
    // means wrangler.toml has an entry we forgot to add to
    // CRON_DISPATCH; log loudly so it shows up in Tail.
    console.error(`[scheduled] no route for cron "${event.cron}"`);
    return;
  }
  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    console.error("[scheduled] CRON_SECRET not set — refusing to dispatch");
    return;
  }
  // Internal fetch — `env.WORKER_URL` lets prod override; default to
  // the production host. The Authorization header satisfies
  // requireCronAuth() on the receiving route.
  const baseUrl = env.WORKER_URL || "https://aster-lang.cloud";
  const url = `${baseUrl}${route}`;
  const started = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "x-cron-source": "worker-scheduled",
        "x-cron-window-start": new Date(event.scheduledTime).toISOString(),
      },
    });
    const elapsed = Date.now() - started;
    if (res.ok) {
      console.log(
        `[scheduled] ${event.cron} -> ${route} ${res.status} in ${elapsed}ms`,
      );
    } else {
      console.error(
        `[scheduled] ${event.cron} -> ${route} ${res.status} in ${elapsed}ms`,
      );
    }
  } catch (err) {
    console.error(`[scheduled] ${event.cron} -> ${route} threw`, err);
  }
}

export default {
  async fetch(request, env, ctx) {
    // 所有请求交给 OpenNext 处理（包含 middleware）
    return openNextWorker.fetch(request, env, ctx);
  },
  async scheduled(event, env, ctx) {
    // Use waitUntil so the scheduled() invocation isn't billed for the
    // entire HTTP round-trip — Workers prefers a quick return.
    ctx.waitUntil(dispatchCron(event, env, ctx));
  },
};
