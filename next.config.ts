import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { validateEnvOrWarn } from './src/lib/env-validation';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// next.config 加载阶段先做一次 env 校验（仅 warn，不阻塞 next build）
// 真正的 fail-fast 在 src/instrumentation.ts 的 register() 里执行（runtime 启动时）
validateEnvOrWarn();

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
