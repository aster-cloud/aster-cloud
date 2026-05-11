import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';
import { validateEnvOrWarn } from './src/lib/env-validation';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

// next.config 加载阶段先做一次 env 校验（仅 warn，不阻塞 next build）
// 真正的 fail-fast 在 src/instrumentation.ts 的 register() 里执行（runtime 启动时）
validateEnvOrWarn();

const policyApiUrl = process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL || 'https://policy.aster-lang.dev';
const policyWsUrl = process.env.NEXT_PUBLIC_ASTER_POLICY_WS_URL || 'wss://policy.aster-lang.dev/ws/preview';
// 从 URL 提取 origin 用于 CSP connect-src
const policyOrigin = new URL(policyApiUrl).origin;
const wsOrigin = new URL(policyWsUrl).origin;
const extraConnectSrc = new Set([policyOrigin, wsOrigin]);
// 生产环境默认值，始终保留
extraConnectSrc.add('https://policy.aster-lang.dev');
extraConnectSrc.add('wss://policy.aster-lang.dev');

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
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://js.stripe.com https://static.cloudflareinsights.com https://cdn.jsdelivr.net",
              "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              `connect-src 'self' https://api.stripe.com ${[...extraConnectSrc].join(' ')} https://static.cloudflareinsights.com https://cdn.jsdelivr.net`,
              "frame-src https://js.stripe.com",
              "form-action 'self' https://github.com https://accounts.google.com",
              "worker-src 'self' blob:",
            ].join('; '),
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
};

export default withNextIntl(nextConfig);
