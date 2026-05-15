import { describe, it, expect } from 'vitest';
import { checkEnv, validateEnvOrThrow } from '@/lib/env-validation';

/**
 * env 校验测试
 *
 * 用 checkEnv(env) 显式注入隔离的 ProcessEnv，避免污染当前进程。
 */

function makeFullProductionEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://x',
    AUTH_SECRET: 'secret',
    STRIPE_SECRET_KEY: 'sk_test',
    STRIPE_WEBHOOK_SECRET: 'whsec',
    NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pro_usd_m',
    NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID: 'price_pro_usd_y',
    NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID: 'price_pro_cny_m',
    NEXT_PUBLIC_STRIPE_PRO_YEARLY_CNY_PRICE_ID: 'price_pro_cny_y',
    NEXT_PUBLIC_MIXPANEL_TOKEN: 'mp-token',
    ASTER_PLAN_GATE_HMAC_KEY: 'hmac-key',
    CRON_SECRET: 'cron-secret',
    RESEND_API_KEY: 're_key',
    NEXT_PUBLIC_APP_URL: 'https://aster-lang.cloud',
  } as NodeJS.ProcessEnv;
}

describe('env-validation', () => {
  it('production 全配齐 → ok', () => {
    const result = checkEnv(makeFullProductionEnv());
    expect(result.ok).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('production 缺 DATABASE_URL → missing', () => {
    const env = makeFullProductionEnv();
    delete env.DATABASE_URL;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.startsWith('DATABASE_URL'))).toBe(true);
  });

  it('production 缺 Pro priceId 任一 → missing', () => {
    const env = makeFullProductionEnv();
    delete env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(
      result.missing.some((m) => m.includes('NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID'))
    ).toBe(true);
  });

  it('production 缺 ASTER_PLAN_GATE_HMAC_KEY → missing', () => {
    const env = makeFullProductionEnv();
    delete env.ASTER_PLAN_GATE_HMAC_KEY;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.includes('ASTER_PLAN_GATE_HMAC_KEY'))).toBe(true);
  });

  it('production 缺 Mixpanel token → missing', () => {
    const env = makeFullProductionEnv();
    delete env.NEXT_PUBLIC_MIXPANEL_TOKEN;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
  });

  it('development 仅缺 production-only env → ok=true，warnings 非空', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
      DATABASE_URL: 'postgres://x',
    } as NodeJS.ProcessEnv;
    const result = checkEnv(env);
    expect(result.ok).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.missing).toEqual([]);
  });

  it('development 缺 always-required → missing', () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv;
    const result = checkEnv(env);
    expect(result.ok).toBe(false);
    expect(result.missing.some((m) => m.startsWith('DATABASE_URL'))).toBe(true);
  });

  it('test 模式跳过', () => {
    expect(() =>
      validateEnvOrThrow({ NODE_ENV: 'test' } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('VITEST=true 跳过', () => {
    expect(() =>
      validateEnvOrThrow({
        NODE_ENV: 'production',
        VITEST: 'true',
      } as NodeJS.ProcessEnv)
    ).not.toThrow();
  });

  it('production 缺 env → validateEnvOrThrow 抛 Error 含 key 名', () => {
    expect(() =>
      validateEnvOrThrow({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)
    ).toThrowError(/DATABASE_URL/);
  });
});
