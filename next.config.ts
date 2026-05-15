import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { validateEnvOrWarn } from './src/lib/env-validation';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// 只在 next build 阶段做一次 warn-only 校验。
//
// 历史踩坑：早先在这里无条件调 validateEnvOrWarn()，
// OpenNext on Cloudflare Workers 会在每个 cold start 重新加载这个模块，
// 而 Worker 的 secret binding 不通过 process.env 暴露 —— 导致 Worker 日志
// 每次冷启都喷一长串"缺失 DATABASE_URL/AUTH_SECRET/..."的 error，
// 看上去像 outage 实际只是 logger 误报（请求是能跑的）。
//
// 真正的 runtime fail-fast 在 src/instrumentation.ts，那里能正确识别
// Cloudflare 运行环境并降级为 warn。
if (process.env.NEXT_PHASE === 'phase-production-build') {
  validateEnvOrWarn();
}

const nextConfig: NextConfig = {
  // Required for OpenNext Cloudflare deployment
  output: "standalone",
  // Fix workspace root detection for pnpm monorepo
  outputFileTracingRoot: __dirname,
  // Externalize heavy client-only packages to prevent bundling issues
  serverExternalPackages: [
    'monaco-editor',
    '@monaco-editor/react',
  ],
  // Security headers (CSP + HSTS + X-Frame-Options + etc.) are now set by
  // src/middleware.ts so we can attach a per-request CSP nonce. Keeping them
  // here too would emit duplicate response headers (and the runtime had been
  // observed to 500 with the duplicates). Leave this hook empty.
};

export default withNextIntl(nextConfig);
