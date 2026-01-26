import type { NextConfig } from "next";
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

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
};

export default withNextIntl(nextConfig);
