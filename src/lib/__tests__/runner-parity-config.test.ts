/*
 * getRunnerParityConfig 校验/fail-closed 行为测试。
 * runner-parity 是纯附加影子校验；配置读任何非法值必须 fail-closed（mode→'off'，pct→夹紧/0），
 * 避免误开销（launcher 调用有成本）。
 *
 * ★测试策略：getRunnerParityConfig → getSetting → db.query.platformSettings.findFirst（真实依赖链）。
 *   mock 最底层 db read（按 eq 的 key 返回受控行），驱动整条链的真实逻辑。用 vi.resetModules 每例
 *   重置 platform-settings 的 60s per-key 缓存，避免跨例污染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// eq(col, val) 捕获查询的 key 到侧信道；db.findFirst 据此返回受控行。
const store = new Map<string, unknown>();
let queriedKey = '';

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, val: unknown) => {
    queriedKey = String(val);
    return { __eqKey: val };
  },
}));

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      platformSettings: {
        findFirst: vi.fn(async () => (store.has(queriedKey) ? { value: store.get(queriedKey) } : undefined)),
      },
    },
  },
  platformSettings: { key: 'key' },
}));

async function readWith(modeVal: unknown, pctVal: unknown) {
  vi.resetModules(); // 重置 platform-settings 的 module 级缓存
  store.clear();
  if (modeVal !== undefined) store.set('runner_parity.mode', modeVal);
  if (pctVal !== undefined) store.set('runner_parity.sample_pct', pctVal);
  const mod = await import('@/lib/platform-settings');
  return mod.getRunnerParityConfig();
}

beforeEach(() => { store.clear(); queriedKey = ''; });

describe('getRunnerParityConfig', () => {
  it('合法 mode+pct 原样返回', async () => {
    expect(await readWith('every', 20)).toEqual({ mode: 'every', samplePct: 20 });
    expect(await readWith('manual', 0)).toEqual({ mode: 'manual', samplePct: 0 });
  });

  it('缺行→默认 off + pct 5（fail-OFF）', async () => {
    expect(await readWith(undefined, undefined)).toEqual({ mode: 'off', samplePct: 5 });
  });

  it('非法 mode→off（fail-closed）', async () => {
    for (const bad of ['garbage', 123, null, {}, '']) {
      expect((await readWith(bad, 10)).mode).toBe('off');
    }
  });

  it('pct 越界/非整数/非有限→夹紧到 [0,100] 或 0', async () => {
    const cases: Array<[unknown, number]> = [
      [150, 100], [-5, 0], [7.9, 7], ['abc', 0], [NaN, 0],
      [Infinity, 0],   // ★非有限 → Number.isFinite=false → fail-closed 0（非 100）
      [100, 100], [0, 0],
    ];
    for (const [input, want] of cases) {
      expect((await readWith('sampled', input)).samplePct).toBe(want);
    }
  });

  it('所有合法 mode 枚举值都被接受', async () => {
    for (const m of ['off', 'sampled', 'every', 'manual']) {
      expect((await readWith(m, 5)).mode).toBe(m);
    }
  });
});
