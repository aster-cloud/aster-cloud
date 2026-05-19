/**
 * Vitest 集成测试配置
 *
 * 用于运行调用真实 Policy API 的集成测试
 * 使用 node 环境而非 jsdom
 */
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // 使用 node 环境进行真实网络调用
    environment: 'node',
    globals: true,
    // 只包含集成测试
    include: ['src/__tests__/integration/**/*.integration.test.ts'],
    // 不使用 jsdom 的 setup 文件
    setupFiles: [],
    // 更长的超时时间
    testTimeout: 60000,
    // 详细输出
    reporters: ['verbose'],
    // 集成测试共用一个 Postgres + 部分共用容器；并行跑会出现 race
    // （license-e2e 和 renewal-flow 都 TRUNCATE 同一组表）。强制串行。
    fileParallelism: false,
    // license-runtime-gate / deployment-mode 在模块加载时即固化 _RUNTIME；
    // 集成测试必须以 on-prem 模式跑，否则 IS_SAAS=true 会让 gate 短路。
    env: {
      DEPLOYMENT_MODE: 'on-prem',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
