/**
 * messages-loader 单元测试（ADR 0018 Phase 2）。
 *
 * 核心契约 = **fail-open**：KV / 后端 fetch / 解析任何一步失败，都 fallback 到
 * 内嵌 messages，绝不抛、绝不白屏。同时验证 happy path（后端命中 → 回填 KV）。
 *
 * mock 策略：
 * - @opennextjs/cloudflare：注入一个内存 KV stub（或抛错模拟非 CF 环境）
 * - global.fetch：模拟后端 200 / 404 / 网络错误
 * - 内嵌 import 用真实的 messages/en.json（构建期存在），验证兜底确实拿到内容
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── KV stub ───────────────────────────────────────────────
class KVStub {
  store = new Map<string, string>();
  get = vi.fn(async (k: string) => this.store.get(k) ?? null);
  put = vi.fn(async (k: string, v: string) => {
    this.store.set(k, v);
  });
}
let kv: KVStub | null;

vi.mock('@opennextjs/cloudflare', () => ({
  getCloudflareContext: vi.fn(async () => {
    if (kv === null) throw new Error('no CF context'); // 模拟本地 dev / 非 CF 环境
    return { env: { CACHE: kv } };
  }),
}));

// 被测模块在 mock 之后 import
import { loadMessages } from '@/i18n/messages-loader';

describe('messages-loader', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    kv = new KVStub();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('后端 200 → 返回后端 messages 并异步回填 KV', async () => {
    const backendTree = { common: { save: 'BACKEND_SAVE' } };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(backendTree), { status: 200 })
    ) as unknown as typeof fetch;

    const msgs = await loadMessages('en');
    expect(msgs).toEqual(backendTree);
    // 短码 en → 全码 en-US
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/messages/en-US'),
      expect.anything()
    );
    // 回填 KV（异步，用 key ui-messages:en-US）
    expect(kv!.put).toHaveBeenCalledWith(
      'ui-messages:en-US',
      JSON.stringify(backendTree),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it('KV 命中 → 直接返回，不打后端', async () => {
    kv!.store.set('ui-messages:zh-CN', JSON.stringify({ common: { save: 'KV_SAVE' } }));
    global.fetch = vi.fn() as unknown as typeof fetch;

    const msgs = await loadMessages('zh');
    expect(msgs).toEqual({ common: { save: 'KV_SAVE' } });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('后端 404 → fail-open 到内嵌 messages（非空，不抛）', async () => {
    global.fetch = vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch;

    const msgs = await loadMessages('en');
    // 内嵌 messages/en.json 真实存在，应拿到非空树（含 common 等 namespace）
    expect(msgs).toBeTypeOf('object');
    expect(Object.keys(msgs).length).toBeGreaterThan(0);
  });

  it('fetch 抛网络错误 → fail-open 到内嵌（不抛）', async () => {
    global.fetch = vi.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const msgs = await loadMessages('en');
    expect(msgs).toBeTypeOf('object');
    expect(Object.keys(msgs).length).toBeGreaterThan(0);
  });

  it('非 CF 环境（无 KV）→ 仍回源后端，正常返回', async () => {
    kv = null; // getCloudflareContext 抛错 → getKV 返回 null
    const backendTree = { common: { save: 'NO_KV' } };
    global.fetch = vi.fn(async () =>
      new Response(JSON.stringify(backendTree), { status: 200 })
    ) as unknown as typeof fetch;

    const msgs = await loadMessages('de');
    expect(msgs).toEqual(backendTree);
  });

  it('后端返回畸形 JSON → fail-open 到内嵌（解析失败不抛）', async () => {
    global.fetch = vi.fn(async () =>
      new Response('not-json{{{', { status: 200 })
    ) as unknown as typeof fetch;

    const msgs = await loadMessages('en');
    expect(msgs).toBeTypeOf('object');
    expect(Object.keys(msgs).length).toBeGreaterThan(0);
  });
});
