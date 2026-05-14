/**
 * R5-FE-Polish-3: lexicon-availability 单元测试。
 *
 * 覆盖 tri-state（authoritative=true/false）+ cache TTL + outage 行为。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchAvailable } from '@/lib/lexicon-availability';
import { resetLexiconAvailabilityCacheForTests as __resetLexiconAvailabilityCache }
  from '@/lib/__internal__/lexicon-availability-test-helpers';

describe('lexicon-availability fetchAvailable', () => {
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __resetLexiconAvailabilityCache();
    originalFetch = globalThis.fetch;
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    // R6-FE-Polish-1: 显式恢复 real timers —— 若某测试中 useFakeTimers() 后断言失败，
    // 不应让后续测试继承 fake timers 状态
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    __resetLexiconAvailabilityCache();
    vi.restoreAllMocks();
  });

  it('fresh fetch success → authoritative=true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'en-US' }, { id: 'zh-CN' },
      ],
    });
    const r = await fetchAvailable();
    expect(r.authoritative).toBe(true);
    expect([...r.available].sort()).toEqual(['en', 'zh']);
  });

  it('cold start + backend unreachable → authoritative=false, only defaultLocale', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const r = await fetchAvailable();
    expect(r.authoritative).toBe(false);
    expect([...r.available]).toEqual(['en']);
  });

  it('second call within TTL uses fresh cache → authoritative=true (no fetch)', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'en-US' }, { id: 'de-DE' }],
    });
    await fetchAvailable();
    fetchMock.mockClear();

    const r = await fetchAvailable();
    expect(r.authoritative).toBe(true);
    expect([...r.available].sort()).toEqual(['de', 'en']);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('TTL expired + refresh fails → authoritative=false but returns stale cache (R4-FE-M)', async () => {
    // 1) 首次成功 — cache 写入 zh-CN
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'en-US' }, { id: 'zh-CN' }],
    });
    await fetchAvailable();

    // 2) 时间过 16s（>15s TTL）
    vi.useFakeTimers();
    vi.advanceTimersByTime(16_000);

    // 3) 第二次 fetch 失败 —— 应该返回 stale cache 但 authoritative=false
    fetchMock.mockRejectedValueOnce(new Error('outage'));
    const r = await fetchAvailable();
    expect(r.authoritative).toBe(false);
    expect([...r.available].sort()).toEqual(['en', 'zh']);

    vi.useRealTimers();
  });

  it('TTL expired + refresh success → cache refreshed, authoritative=true', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'en-US' }, { id: 'zh-CN' }],
    });
    await fetchAvailable();

    vi.useFakeTimers();
    vi.advanceTimersByTime(16_000);

    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'en-US' }], // zh 被拔了
    });
    const r = await fetchAvailable();
    expect(r.authoritative).toBe(true);
    expect([...r.available]).toEqual(['en']);

    vi.useRealTimers();
  });

  it('HTTP non-2xx response → treated as error → authoritative=false', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
    });
    const r = await fetchAvailable();
    expect(r.authoritative).toBe(false);
  });

  it('backend returns empty list → still includes defaultLocale', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    const r = await fetchAvailable();
    expect(r.authoritative).toBe(true);
    expect([...r.available]).toEqual(['en']);
  });

  it('locale id intersection: backend has fr-FR but compiled does not → no fr', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'en-US' },
        { id: 'fr-FR' }, // 不在 compiled locales
        { id: 'zh-CN' },
      ],
    });
    const r = await fetchAvailable();
    expect([...r.available].sort()).toEqual(['en', 'zh']);
  });

  it('AbortError from timeout → caught and degraded to authoritative=false', async () => {
    // 直接模拟 fetch 抛 AbortError（AbortSignal.timeout 实际触发的情况）
    const abortErr = new DOMException('signal timed out', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortErr);
    const r = await fetchAvailable();
    expect(r.authoritative).toBe(false);
    // cold start → only defaultLocale
    expect([...r.available]).toEqual(['en']);
  });
});
