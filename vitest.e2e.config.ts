// E2E 测试专用配置：仅跑 src/__tests__/e2e/**
// 默认 vitest run 不会包含此目录（见 vitest.config.ts exclude）
//
// 运行：pnpm test:e2e
// 前提：dev server 在 http://localhost:3001（或设 E2E_BASE_URL）
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/__tests__/e2e/**/*.{test,spec}.{ts,tsx,js}'],
    testTimeout: 30000,
    hookTimeout: 15000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
