/**
 * Vitest 集成测试 — SaaS 子集.
 *
 * 部分集成测试驱动的代码（ingest endpoint / renewal portal API）需要
 * IS_SAAS=true 才能让 route handler 不返回 404。这些代码 IS_SAAS 在模块
 * 加载时即固化，跨 test 文件没法切换。所以拆 saas / on-prem 两套
 * vitest config，CI 顺序跑：
 *   - vitest.integration.config.ts        → on-prem (license-e2e / renewal-flow)
 *   - vitest.integration.saas.config.ts   → saas    (telemetry-ingest)
 */

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    // Only files that explicitly mark themselves as saas-side
    include: ['src/__tests__/integration/**/*.saas.integration.test.ts'],
    setupFiles: [],
    testTimeout: 60000,
    reporters: ['verbose'],
    fileParallelism: false,
    env: {
      DEPLOYMENT_MODE: 'saas',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
