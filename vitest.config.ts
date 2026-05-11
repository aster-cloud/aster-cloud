import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // 排除集成测试与 E2E（各自独立 config 跑）
    exclude: ['src/__tests__/integration/**', 'src/__tests__/e2e/**', 'node_modules/**'],
    coverage: {
      // 需要 @vitest/coverage-v8（未安装时 pnpm test:coverage 会引导安装）
      provider: 'v8',
      reporter: ['text', 'json', 'lcov', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'node_modules/',
        'src/__tests__/**',
        'src/scripts/**',
        // 客户端 UI 组件大量靠手工测试，暂不纳入门槛
        'src/components/policy/monaco-policy-editor.tsx',
        'src/app/[locale]/(marketing)/**',
        'src/instrumentation.ts',
        '**/*.d.ts',
        '**/*.config.{ts,js,mjs}',
      ],
      // CI 门槛：核心业务逻辑覆盖率
      // 仅对 lib/ 目录强约束（plan-quota / plans / mixpanel / env-validation 等纯逻辑）
      thresholds: {
        'src/lib/plan-quota.ts': { statements: 90, branches: 80, functions: 100, lines: 90 },
        'src/lib/env-validation.ts': { statements: 90, branches: 80, functions: 80, lines: 90 },
      },
    },
    // 集成测试超时设置
    testTimeout: 30000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
