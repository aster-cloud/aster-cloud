// Next.js Instrumentation hook — 服务器启动时执行一次
// 详见 https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// 用途：production 启动时校验关键 env，缺失立即 throw 让 K8s readiness probe 失败，
// 避免缺 env 的实例进流量池。

import { validateEnvOrThrow, validateEnvOrWarn } from './lib/env-validation';

export async function register() {
  // Skip on Edge runtime entirely (NextRequest API differs).
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== 'nodejs') return;

  // OpenNext on Cloudflare Workers reports NEXT_RUNTIME=nodejs even though
  // Worker secrets are bound differently. If we detect we're on CF (via
  // any of its signature env vars), warn instead of throwing so the worker
  // can boot; missing secrets will surface as runtime errors at the
  // specific call site (Stripe init, DB connect, …) rather than killing
  // every request at startup.
  const isCloudflareWorker =
    typeof globalThis.caches !== 'undefined' &&
    'default' in (globalThis.caches as unknown as { default?: unknown });

  if (isCloudflareWorker) {
    validateEnvOrWarn();
    return;
  }

  validateEnvOrThrow();
}
