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
    const originalNodeEnv = process.env.NODE_ENV;
    const originalMode = process.env.DEPLOYMENT_MODE;
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      configurable: true,
      writable: true,
      enumerable: true,
    });
    delete process.env.DEPLOYMENT_MODE;
    try {
      await expect(
        import('@/lib/deployment-mode?fresh=fail-closed' as string),
      ).rejects.toThrow(/was not compiled into the build/);
    } finally {
      Object.defineProperty(process.env, 'NODE_ENV', {
        value: originalNodeEnv ?? 'test',
        configurable: true,
        writable: true,
        enumerable: true,
      });
      if (originalMode !== undefined) process.env.DEPLOYMENT_MODE = originalMode;
    }
  });
});
