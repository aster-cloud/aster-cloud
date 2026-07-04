// 分布式速率限制测试（审计 #168）。
//
// 钉住：①KV 可用时全局固定窗口计数（到上限拒）②窗口滚动后重置 ③KV 不可用 → 回退内存限流
// ④KV 读失败 → fail-open（不因限流基础设施抖动拒合法用户）⑤remaining/resetAt 正确。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// mock getCloudflareContext（getKV 用它取 env.CACHE）。默认无 KV → 走内存回退分支；
// 需要 KV 的用例里覆盖为返回带 CACHE 的 env。
const mockGetCloudflareContext = vi.fn(async () => ({ env: {} as { CACHE?: unknown } }));
vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: mockGetCloudflareContext,
}));

import { checkRateLimitDistributed } from '@/lib/rate-limit-distributed';
import { resetRateLimit } from '@/lib/rate-limit';

/** 简单的内存 KV mock（模拟 Cloudflare KVNamespace 的 get/put）。 */
function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
}

const CFG = { windowMs: 60_000, maxRequests: 3 };

describe('checkRateLimitDistributed (审计 #168)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCloudflareContext.mockResolvedValue({ env: {} });
  });
  afterEach(() => {
    resetRateLimit('u1'); // 清内存回退状态，避免测试间串扰
  });

  it('KV 可用：固定窗口计数，到上限即拒（全局，跨调用共享）', async () => {
    const kv = makeKv();
    mockGetCloudflareContext.mockResolvedValue({ env: { CACHE: kv } });
    const now = 1_000_000;

    const r1 = await checkRateLimitDistributed('u1', CFG, now);
    await checkRateLimitDistributed('u1', CFG, now);
    const r3 = await checkRateLimitDistributed('u1', CFG, now);
    const r4 = await checkRateLimitDistributed('u1', CFG, now);

    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(2);
    expect(r3.allowed).toBe(true);
    expect(r3.remaining).toBe(0);
    expect(r4.allowed).toBe(false); // 第 4 次超上限 3
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('KV 可用：窗口滚动后计数重置（新窗口 key）', async () => {
    const kv = makeKv();
    mockGetCloudflareContext.mockResolvedValue({ env: { CACHE: kv } });
    const w1 = 1_000_000;
    await checkRateLimitDistributed('u1', CFG, w1);
    await checkRateLimitDistributed('u1', CFG, w1);
    await checkRateLimitDistributed('u1', CFG, w1);
    expect((await checkRateLimitDistributed('u1', CFG, w1)).allowed).toBe(false);

    // 跨到下一个窗口（+windowMs）→ 新 key → 重新放行
    const w2 = w1 + CFG.windowMs;
    expect((await checkRateLimitDistributed('u1', CFG, w2)).allowed).toBe(true);
  });

  it('KV 不可用（非 Cloudflare）→ 回退内存限流（仍能限流）', async () => {
    mockGetCloudflareContext.mockRejectedValue(new Error('not on cloudflare'));
    const r1 = await checkRateLimitDistributed('u1', CFG);
    await checkRateLimitDistributed('u1', CFG);
    await checkRateLimitDistributed('u1', CFG);
    const r4 = await checkRateLimitDistributed('u1', CFG);
    expect(r1.allowed).toBe(true);
    expect(r4.allowed).toBe(false); // 内存限流同样在第 4 次拒
  });

  it('KV 读失败 → fail-open 到内存限流（不拒合法用户）', async () => {
    const kv = makeKv();
    kv.get.mockRejectedValue(new Error('kv read blip'));
    mockGetCloudflareContext.mockResolvedValue({ env: { CACHE: kv } });
    const r = await checkRateLimitDistributed('u1', CFG);
    expect(r.allowed).toBe(true); // 首次经内存回退放行，不因 KV 抖动拒绝
  });

  it('★KV 可读不可写 → 回退内存限流（仍限流，不是 fail-open to nothing）', async () => {
    // Codex 复审 High：put 失败若只放行不计数 = 攻击者打挂 KV 写即近乎无限流。
    // 修复后：写失败进 catch → 回退内存 checkRateLimit，仍在第 4 次拒。
    const kv = makeKv();
    kv.put.mockRejectedValue(new Error('kv write quota exceeded'));
    mockGetCloudflareContext.mockResolvedValue({ env: { CACHE: kv } });
    const r1 = await checkRateLimitDistributed('u1', CFG);
    await checkRateLimitDistributed('u1', CFG);
    await checkRateLimitDistributed('u1', CFG);
    const r4 = await checkRateLimitDistributed('u1', CFG);
    expect(r1.allowed).toBe(true);
    expect(r4.allowed).toBe(false); // 内存兜底仍在第 4 次拒，非无限流
  });

  it('resetAt 对齐窗口边界', async () => {
    const kv = makeKv();
    mockGetCloudflareContext.mockResolvedValue({ env: { CACHE: kv } });
    const now = 1_234_567; // 非边界
    const r = await checkRateLimitDistributed('u1', CFG, now);
    const expectedWindowStart = Math.floor(now / CFG.windowMs) * CFG.windowMs;
    expect(r.resetAt).toBe(expectedWindowStart + CFG.windowMs);
  });
});
