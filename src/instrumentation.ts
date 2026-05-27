// Next.js Instrumentation hook — 服务器启动时执行一次
// 详见 https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
//
// 用途：production 启动时校验关键 env，缺失立即 throw 让 K8s readiness probe 失败，
// 避免缺 env 的实例进流量池。

import { validateEnvOrThrow, validateEnvOrWarn } from './lib/env-validation';

export async function register() {
  // P0-R5 (codex round 5 review): 在 Workers / Node runtime 设置全局
  // production 标志。aster-lang-ts isProductionRuntime() 通过此标志在
  // 无 process.env 编译期内联的环境（如 CF Workers）下也能正确判定。
  // 配合 typecheck/browser.ts __setPiiCheckerForTest 的 production guard
  // 确保浏览器/Workers 端无法关闭 PII analyzer。
  if (process.env.NODE_ENV === 'production') {
    (globalThis as { __ASTER_PRODUCTION__?: boolean }).__ASTER_PRODUCTION__ = true;
  }

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
