import { describe, it, expect, beforeEach, afterAll } from 'vitest';

/**
 * Stripe priceId 完整性 contract test
 *
 * 在测试态注入预期的 env，重新 import plans.ts 后验证 getPriceIdMap() 输出，
 * 让"Stripe Dashboard 应配的 SKU"与代码 expectation 永远对齐。
 *
 * 触发场景：
 *   - 商业化新增一档 / 新货币 → 这里加期望，CI 强制提醒同步 env
 *   - env 重命名 → 这里立刻发现命名漂移
 *
 * 注意：Vite 通过 import.meta.env / process.env 解析 env，必须用 vi.resetModules
 * 才能让 plans.ts 重新读取注入值。
 */

const ENVS_BACKUP = {
  // Pro
  USD_M: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID,
  USD_Y: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID,
  CNY_M: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID,
  CNY_Y: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_CNY_PRICE_ID,
  EUR_M: process.env.NEXT_PUBLIC_STRIPE_PRO_MONTHLY_EUR_PRICE_ID,
  EUR_Y: process.env.NEXT_PUBLIC_STRIPE_PRO_YEARLY_EUR_PRICE_ID,
  // Team（legacy）
  T_USD_M: process.env.NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_PRICE_ID,
  T_USD_Y: process.env.NEXT_PUBLIC_STRIPE_TEAM_YEARLY_PRICE_ID,
  T_CNY_M: process.env.NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_CNY_PRICE_ID,
  T_CNY_Y: process.env.NEXT_PUBLIC_STRIPE_TEAM_YEARLY_CNY_PRICE_ID,
  T_EUR_M: process.env.NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_EUR_PRICE_ID,
  T_EUR_Y: process.env.NEXT_PUBLIC_STRIPE_TEAM_YEARLY_EUR_PRICE_ID,
};

function setEnv(values: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterAll(() => {
  // 还原，避免污染其他测试
  setEnv({
    NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID: ENVS_BACKUP.USD_M,
    NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID: ENVS_BACKUP.USD_Y,
    NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID: ENVS_BACKUP.CNY_M,
    NEXT_PUBLIC_STRIPE_PRO_YEARLY_CNY_PRICE_ID: ENVS_BACKUP.CNY_Y,
    NEXT_PUBLIC_STRIPE_PRO_MONTHLY_EUR_PRICE_ID: ENVS_BACKUP.EUR_M,
    NEXT_PUBLIC_STRIPE_PRO_YEARLY_EUR_PRICE_ID: ENVS_BACKUP.EUR_Y,
    NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_PRICE_ID: ENVS_BACKUP.T_USD_M,
    NEXT_PUBLIC_STRIPE_TEAM_YEARLY_PRICE_ID: ENVS_BACKUP.T_USD_Y,
    NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_CNY_PRICE_ID: ENVS_BACKUP.T_CNY_M,
    NEXT_PUBLIC_STRIPE_TEAM_YEARLY_CNY_PRICE_ID: ENVS_BACKUP.T_CNY_Y,
    NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_EUR_PRICE_ID: ENVS_BACKUP.T_EUR_M,
    NEXT_PUBLIC_STRIPE_TEAM_YEARLY_EUR_PRICE_ID: ENVS_BACKUP.T_EUR_Y,
  });
});

/**
 * Pro 在三种货币 × 月/年 = 6 个 priceId 全部配齐时的反查
 *
 * 这一组 env 是 PM v1.1 后台同事必须在 Stripe Dashboard 配齐的 SKU 列表（详见
 * aster-deploy/docs/pm/05-pricing-packaging.md F2 章节），任何一个缺失都意味着客户
 * 升级时找不到对应 priceId 而失败。
 */
describe('Stripe priceId contract (Pro 完整覆盖)', () => {
  beforeEach(async () => {
    setEnv({
      NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pro_usd_m',
      NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID: 'price_pro_usd_y',
      NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID: 'price_pro_cny_m',
      NEXT_PUBLIC_STRIPE_PRO_YEARLY_CNY_PRICE_ID: 'price_pro_cny_y',
      NEXT_PUBLIC_STRIPE_PRO_MONTHLY_EUR_PRICE_ID: 'price_pro_eur_m',
      NEXT_PUBLIC_STRIPE_PRO_YEARLY_EUR_PRICE_ID: 'price_pro_eur_y',
    });
    const { vi } = await import('vitest');
    vi.resetModules();
  });

  it('Pro 三货币 × 月/年 共 6 个 priceId 都能反查到', async () => {
    const { getPriceIdMap, lookupPriceId } = await import('@/lib/plans');
    const map = getPriceIdMap();

    expect(map['price_pro_usd_m']).toEqual({ plan: 'pro', interval: 'monthly', currency: 'USD' });
    expect(map['price_pro_usd_y']).toEqual({ plan: 'pro', interval: 'yearly', currency: 'USD' });
    expect(map['price_pro_cny_m']).toEqual({ plan: 'pro', interval: 'monthly', currency: 'CNY' });
    expect(map['price_pro_cny_y']).toEqual({ plan: 'pro', interval: 'yearly', currency: 'CNY' });
    expect(map['price_pro_eur_m']).toEqual({ plan: 'pro', interval: 'monthly', currency: 'EUR' });
    expect(map['price_pro_eur_y']).toEqual({ plan: 'pro', interval: 'yearly', currency: 'EUR' });

    expect(lookupPriceId('price_pro_cny_m')?.plan).toBe('pro');
    expect(lookupPriceId('not-in-stripe')).toBeNull();
    expect(lookupPriceId(undefined)).toBeNull();
  });

  it('PM 文档要求的 6 个 Pro env 必须在 Stripe Dashboard 配齐', async () => {
    const { getPriceIdMap } = await import('@/lib/plans');
    const map = getPriceIdMap();
    const proEntries = Object.values(map).filter((v) => v.plan === 'pro');
    expect(proEntries.length).toBe(6);
    // 三种货币各一对（monthly + yearly）
    const byCurrency = new Map<string, number>();
    for (const e of proEntries) byCurrency.set(e.currency, (byCurrency.get(e.currency) ?? 0) + 1);
    expect(byCurrency.get('USD')).toBe(2);
    expect(byCurrency.get('CNY')).toBe(2);
    expect(byCurrency.get('EUR')).toBe(2);
  });
});

/**
 * 缺失 env 时反查表只包含已配置项，不会抛错——也不会假装存在
 *
 * 这模拟"商业化只配了 CNY，USD/EUR 还没建好"的中间状态，
 * checkout/route.ts 应当返回 400 给前端，前端再 fallback 到 USD 或显示"暂未支持该货币"。
 */
describe('Stripe priceId contract (部分缺失场景)', () => {
  beforeEach(async () => {
    setEnv({
      NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_PRO_YEARLY_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_PRO_MONTHLY_CNY_PRICE_ID: 'price_pro_cny_m_only',
      NEXT_PUBLIC_STRIPE_PRO_YEARLY_CNY_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_PRO_MONTHLY_EUR_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_PRO_YEARLY_EUR_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_TEAM_YEARLY_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_CNY_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_TEAM_YEARLY_CNY_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_TEAM_MONTHLY_EUR_PRICE_ID: undefined,
      NEXT_PUBLIC_STRIPE_TEAM_YEARLY_EUR_PRICE_ID: undefined,
    });
    const { vi } = await import('vitest');
    vi.resetModules();
  });

  it('缺失的 priceId 不出现在反查表里', async () => {
    const { getPriceIdMap, lookupPriceId } = await import('@/lib/plans');
    const map = getPriceIdMap();
    expect(Object.keys(map)).toEqual(['price_pro_cny_m_only']);
    expect(lookupPriceId('price_pro_cny_m_only')?.currency).toBe('CNY');
    expect(lookupPriceId('price_pro_eur_y')).toBeNull();
  });
});
