/**
 * messages-loader 单元测试（ADR 0018 Phase 2 + ADR 0020 优化 1：版本化 KV key）。
 *
 * 核心契约 = **fail-open**：KV / 后端 fetch / 解析任何一步失败，都 fallback 到
 * 内嵌 messages，绝不抛、绝不白屏。同时验证 happy path（manifest 版本 → 版本化 KV →
 * 后端命中 → 回填）。
 *
 * mock 策略：
 * - @opennextjs/cloudflare：注入一个内存 KV stub（或抛错模拟非 CF 环境）
 * - global.fetch：按 URL 路由——/messages-manifest 返回 {locale,sha}[]，
 *   /messages/<id> 返回文案树
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

/**
 * 按 URL 路由的 fetch mock：manifest 返回给定 {locale,sha}[]，messages 返回 body。
 * messagesBody=null 时 messages 端点返回 404。
 * messagesEtag 设置 body 响应的 ETag（版本一致性校验用）；默认与 manifest 第一个 sha
 * 一致（happy path），可显式传不同值模拟 split-brain。
 */
function routedFetch(opts: {
  manifest?: Array<{ locale: string; sha: string }>;
  messagesBody?: string | null;
  messagesStatus?: number;
  messagesEtag?: string | null;
}) {
  return vi.fn(async (url: string) => {
    if (String(url).includes('/api/v1/messages-manifest')) {
      return new Response(JSON.stringify(opts.manifest ?? []), { status: 200 });
    }
    if (opts.messagesBody == null) {
      return new Response('', { status: opts.messagesStatus ?? 404 });
    }
    // 默认 body ETag = manifest 第一个 sha（一致），除非显式覆盖。
    const defaultEtag = opts.manifest?.[0]?.sha
      ? `"${opts.manifest[0].sha}ffffffffffffffffffffffffffffffffffffffffffffffffffffffff"`
      : undefined;
    const etag = opts.messagesEtag === undefined ? defaultEtag : opts.messagesEtag;
    const headers: Record<string, string> = {};
    if (etag) headers['ETag'] = etag;
    return new Response(opts.messagesBody, { status: opts.messagesStatus ?? 200, headers });
  }) as unknown as typeof fetch;
}

describe('messages-loader', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    kv = new KVStub();
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('后端 200 → 返回后端 messages 并异步回填版本化 KV', async () => {
    const backendTree = { common: { save: 'BACKEND_SAVE' } };
    global.fetch = routedFetch({
      manifest: [{ locale: 'en-US', sha: 'abc12345' }],
      messagesBody: JSON.stringify(backendTree),
    });

    const msgs = await loadMessages('en');
    expect(msgs).toEqual(backendTree);
    // 短码 en → 全码 en-US
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/messages/en-US'),
      expect.anything()
    );
    // 回填 KV，key 含版本 sha（ADR 0020）
    expect(kv!.put).toHaveBeenCalledWith(
      'ui-messages:en-US:vabc12345',
      JSON.stringify(backendTree),
      expect.objectContaining({ expirationTtl: expect.any(Number) })
    );
  });

  it('版本化 KV key 命中 → 直接返回，不打 messages 后端', async () => {
    // 预置版本化 key（sha 与 manifest 一致）
    kv!.store.set('ui-messages:zh-CN:vdeadbeef', JSON.stringify({ common: { save: 'KV_SAVE' } }));
    global.fetch = routedFetch({ manifest: [{ locale: 'zh-CN', sha: 'deadbeef' }] });

    const msgs = await loadMessages('zh');
    expect(msgs).toEqual({ common: { save: 'KV_SAVE' } });
    // manifest 仍会 fetch（拿版本），但 messages body 端点不该被打
    const messagesCalls = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c) => String(c[0]).includes('/api/v1/messages/zh-CN')
    );
    expect(messagesCalls).toHaveLength(0);
  });

  it('版本变化（manifest sha 变）→ 旧 KV key miss → 回源新版本（不吃旧值）', async () => {
    // KV 里是旧版本 key，但 manifest 报新 sha → 新 key miss → 回源
    kv!.store.set('ui-messages:zh-CN:vOLDSHA00', JSON.stringify({ common: { save: 'STALE' } }));
    const fresh = { common: { save: 'FRESH' } };
    global.fetch = routedFetch({
      manifest: [{ locale: 'zh-CN', sha: 'NEWSHA11' }],
      messagesBody: JSON.stringify(fresh),
    });

    const msgs = await loadMessages('zh');
    expect(msgs).toEqual(fresh); // 拿到新版本，不是 STALE —— 正是优化 1 的价值
    expect(kv!.put).toHaveBeenCalledWith(
      'ui-messages:zh-CN:vNEWSHA11',
      JSON.stringify(fresh),
      expect.anything()
    );
  });

  it('split-brain: manifest 报新 sha 但 body ETag 是旧 sha → 不污染版本化 key', async () => {
    // 滚动发布/多实例下：manifest 命中新实例(NEWSHA11)，body 命中旧实例(返回旧 ETag)。
    // 不能把旧 body 写进 v新sha key（否则被长 TTL 钉住=错版本污染，Codex 审查）。
    const body = { common: { save: 'POSSIBLY_STALE_BODY' } };
    global.fetch = routedFetch({
      manifest: [{ locale: 'zh-CN', sha: 'NEWSHA11' }],
      messagesBody: JSON.stringify(body),
      messagesEtag: '"OLDSHA00aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"', // 旧 sha
    });

    const msgs = await loadMessages('zh');
    // 本次请求仍返回 body（fail-open，不白屏）
    expect(msgs).toEqual(body);
    // 但**绝不**写进 v新sha key（避免错版本污染）
    const pollutingWrite = kv!.put.mock.calls.find(
      (c) => c[0] === 'ui-messages:zh-CN:vNEWSHA11'
    );
    expect(pollutingWrite).toBeUndefined();
  });

  it('body 无 ETag（无法校验版本）→ 不回填版本化 key', async () => {
    global.fetch = routedFetch({
      manifest: [{ locale: 'zh-CN', sha: 'SOMESHA1' }],
      messagesBody: JSON.stringify({ common: { save: 'NO_ETAG' } }),
      messagesEtag: null, // 显式无 ETag
    });

    const msgs = await loadMessages('zh');
    expect(msgs).toEqual({ common: { save: 'NO_ETAG' } });
    const versionedWrite = kv!.put.mock.calls.find(
      (c) => c[0] === 'ui-messages:zh-CN:vSOMESHA1'
    );
    expect(versionedWrite).toBeUndefined();
  });

  it('manifest 不可达 → 退回固定 key（仍 fail-open 可用）', async () => {
    const backendTree = { common: { save: 'NO_MANIFEST' } };
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/v1/messages-manifest')) {
        return new Response('', { status: 500 }); // manifest 挂
      }
      return new Response(JSON.stringify(backendTree), { status: 200 });
    }) as unknown as typeof fetch;

    const msgs = await loadMessages('de');
    expect(msgs).toEqual(backendTree);
    // 无 sha → 退回固定 key（非版本化）
    expect(kv!.put).toHaveBeenCalledWith(
      'ui-messages:de-DE',
      JSON.stringify(backendTree),
      expect.anything()
    );
  });

  it('后端 404 → fail-open 到内嵌 messages（非空，不抛）', async () => {
    global.fetch = routedFetch({ manifest: [], messagesBody: null, messagesStatus: 404 });

    const msgs = await loadMessages('en');
    // 内嵌兜底（@aster-cloud/ui-messages/en-US.json）真实存在，应拿到非空树（含 common 等）
    expect(msgs).toBeTypeOf('object');
    expect(Object.keys(msgs).length).toBeGreaterThan(0);
  });

  it('hi 后端 404 → fail-open 到 hi 内嵌（@aster-cloud/ui-messages-hi/hi-IN.json，非空，不抛）', async () => {
    global.fetch = routedFetch({ manifest: [], messagesBody: null, messagesStatus: 404 });

    const msgs = await loadMessages('hi');
    // hi 内嵌源是**独立的 -hi 包**（与 en/zh/de 不同包），验证它能作兜底正常加载。
    expect(msgs).toBeTypeOf('object');
    expect(Object.keys(msgs).length).toBeGreaterThan(0);
    // hi 全量翻译含 platformLanguageSettings 等 namespace（非仅 en 兜底）。
    expect(msgs).toHaveProperty('platformLanguageSettings');
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
    global.fetch = routedFetch({
      manifest: [{ locale: 'de-DE', sha: 'aaaa1111' }],
      messagesBody: JSON.stringify(backendTree),
    });

    const msgs = await loadMessages('de');
    expect(msgs).toEqual(backendTree);
  });

  it('后端返回畸形 JSON → fail-open 到内嵌（解析失败不抛）', async () => {
    global.fetch = routedFetch({
      manifest: [{ locale: 'en-US', sha: 'abc12345' }],
      messagesBody: 'not-json{{{',
    });

    const msgs = await loadMessages('en');
    expect(msgs).toBeTypeOf('object');
    expect(Object.keys(msgs).length).toBeGreaterThan(0);
  });
});
