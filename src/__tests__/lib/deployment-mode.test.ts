/**
 * deployment-mode helper 行为：
 *   - 默认（无 env、无 macro）应回退 'saas'
 *   - DEPLOYMENT_MODE=on-prem 应识别 on-prem
 *   - CAN_BILLING / CAN_LICENSE 等谓词与模式一致
 *   - CAPABILITIES 对象与单独常量值一致
 *
 * 注意：本测试在 vitest 环境运行，`__DEPLOYMENT_MODE__` macro 不存在，
 * helper 走 env 回退路径。production fail-closed 分支（NODE_ENV=production
 * 且 macro 未定义）不在本测试覆盖范围 —— 那是构建期错误，由 verify-bundle
 * 脚本守门。
 */
import { describe, it, expect } from 'vitest';

describe('deployment-mode', () => {
  it('defaults to saas when DEPLOYMENT_MODE env is unset', async () => {
    const original = process.env.DEPLOYMENT_MODE;
    delete process.env.DEPLOYMENT_MODE;
    try {
      // 必须 dynamic import 才能让模块在 env 改动后重新求值
      const mod = await import('@/lib/deployment-mode?fresh=1' as string);
      expect(mod.IS_SAAS).toBe(true);
      expect(mod.IS_ONPREM).toBe(false);
      expect(mod.CAN_BILLING).toBe(true);
      expect(mod.CAN_LICENSE).toBe(false);
      expect(mod.CAPABILITIES.billing).toBe(true);
      expect(mod.CAPABILITIES.license).toBe(false);
    } finally {
      if (original !== undefined) process.env.DEPLOYMENT_MODE = original;
    }
  });

  it('exports a CAPABILITIES object whose values match the individual flags', async () => {
    const mod = await import('@/lib/deployment-mode');
    expect(mod.CAPABILITIES.billing).toBe(mod.CAN_BILLING);
    expect(mod.CAPABILITIES.pricing).toBe(mod.CAN_PRICING);
    expect(mod.CAPABILITIES.riskTier).toBe(mod.CAN_RISKTIER);
    expect(mod.CAPABILITIES.dunning).toBe(mod.CAN_DUNNING);
    expect(mod.CAPABILITIES.signup).toBe(mod.CAN_SIGNUP);
    expect(mod.CAPABILITIES.mixpanel).toBe(mod.CAN_MIXPANEL);
    expect(mod.CAPABILITIES.resend).toBe(mod.CAN_RESEND);
    expect(mod.CAPABILITIES.license).toBe(mod.CAN_LICENSE);
    expect(mod.CAPABILITIES.sso).toBe(mod.CAN_SSO);
  });

  it('IS_SAAS and IS_ONPREM are mutually exclusive', async () => {
    const mod = await import('@/lib/deployment-mode');
    expect(mod.IS_SAAS).not.toBe(mod.IS_ONPREM);
  });

  it('getDeploymentMode returns "saas" or "on-prem"', async () => {
    const mod = await import('@/lib/deployment-mode');
    const mode = mod.getDeploymentMode();
    expect(['saas', 'on-prem']).toContain(mode);
  });

  it('switches to on-prem when DEPLOYMENT_MODE=on-prem', async () => {
    const original = process.env.DEPLOYMENT_MODE;
    process.env.DEPLOYMENT_MODE = 'on-prem';
    try {
      const mod = await import('@/lib/deployment-mode?fresh=onprem' as string);
      expect(mod.IS_ONPREM).toBe(true);
      expect(mod.IS_SAAS).toBe(false);
      expect(mod.CAN_BILLING).toBe(false);
      expect(mod.CAN_LICENSE).toBe(true);
      expect(mod.CAN_SSO).toBe(true);
      expect(mod.CAPABILITIES.billing).toBe(false);
      expect(mod.CAPABILITIES.license).toBe(true);
    } finally {
      if (original === undefined) delete process.env.DEPLOYMENT_MODE;
      else process.env.DEPLOYMENT_MODE = original;
    }
  });

  it('throws fail-closed in production when macro is not injected', async () => {
    // 验证 production + 无 macro = throw。模拟"代码运行在 production
    // 但 DefinePlugin 没生效"的故障模式（spike report §11 列出的实际风险）。
    //
    // helper 对两种合法 "production-但 macro 还没注入" 场景豁免：
    //   - NEXT_PHASE === 'phase-production-build'（next build 时 next.config.ts 加载）
    //   - VITEST === 'true'（vitest 默认设置；测试自身不该误伤）
    // 本测试要触发 throw，必须同时清除这两个旗帜。
    const originalNodeEnv = process.env.NODE_ENV;
    const originalMode = process.env.DEPLOYMENT_MODE;
    const originalPhase = process.env.NEXT_PHASE;
    const originalVitest = process.env.VITEST;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
      writable: true,
      enumerable: true,
    });
    delete process.env.DEPLOYMENT_MODE;
    delete process.env.NEXT_PHASE;
    delete process.env.VITEST;
    try {
      // Module import 不应 throw（避免误伤 next build 的配置加载）。
      // 真正的 fail-closed 在 getDeploymentMode() 调用时触发。
      const mod = await import('@/lib/deployment-mode?fresh=fail-closed' as string);
      expect(() => mod.getDeploymentMode()).toThrow(
        /was not compiled into the build/,
      );
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: originalNodeEnv ?? 'test',
        configurable: true,
        writable: true,
        enumerable: true,
      });
      if (originalMode !== undefined) process.env.DEPLOYMENT_MODE = originalMode;
      if (originalPhase !== undefined) process.env.NEXT_PHASE = originalPhase;
      if (originalVitest !== undefined) process.env.VITEST = originalVitest;
    }
  });

  it('does NOT throw during next build (NEXT_PHASE=phase-production-build)', async () => {
    // next.config.ts 加载时会 import 此模块；DefinePlugin 还没运行。
    // 必须放行，否则 next build 会被自己的 fail-closed 误伤。
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPhase = process.env.NEXT_PHASE;
    const originalMode = process.env.DEPLOYMENT_MODE;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
      writable: true,
      enumerable: true,
    });
    process.env.NEXT_PHASE = 'phase-production-build';
    delete process.env.DEPLOYMENT_MODE;
    try {
      // 期望不抛
      const mod = await import('@/lib/deployment-mode?fresh=build-phase' as string);
      expect(mod.getDeploymentMode()).toBe('saas'); // 回退默认
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: originalNodeEnv ?? 'test',
        configurable: true,
        writable: true,
        enumerable: true,
      });
      if (originalPhase !== undefined) process.env.NEXT_PHASE = originalPhase;
      else delete process.env.NEXT_PHASE;
      if (originalMode !== undefined) process.env.DEPLOYMENT_MODE = originalMode;
    }
  });
});
