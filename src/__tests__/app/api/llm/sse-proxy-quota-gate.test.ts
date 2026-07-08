import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

/**
 * proxyLlmSse（/api/llm/generate + /api/llm/suggest 共用）AI 配额门控 + 成功记账回归。
 *
 * 与 complete 路径同一缺陷：SSE 代理此前不检查配额且成功调用不记账。本测试锁定：
 * quota 拒绝 → 直接返回、不 fetch 上游；quota 放行 + 上游 2xx → 转发 SSE 流并记一笔 success
 * （驱动 checkAiQuota 的月配额/速率计数）。
 */

const { mockAuth, mockCheckAiQuota, mockRecordAiUsage, mockSign, mockResolveByok, mockInjectByok } = vi.hoisted(() => ({
  mockAuth: vi.fn(),
  mockCheckAiQuota: vi.fn(),
  mockRecordAiUsage: vi.fn(),
  mockSign: vi.fn(),
  mockResolveByok: vi.fn(),
  mockInjectByok: vi.fn(),
}));

vi.mock('@/auth', () => ({ auth: mockAuth }));
vi.mock('@/lib/ai-quota', () => ({
  checkAiQuota: mockCheckAiQuota,
  recordAiUsage: mockRecordAiUsage,
}));
vi.mock('@/lib/api-signing', () => ({ signInternalCallerHeaders: mockSign }));
vi.mock('@/lib/byok-envelope', () => ({
  resolveByokEnvelope: mockResolveByok,
  injectByokEnvelope: mockInjectByok,
}));

function req(): Request {
  return new Request('http://cloud.test/api/llm/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'x' }),
  });
}

function sseStreamResponse(): Response {
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('event: delta\ndata: hi\n\n'));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

describe('proxyLlmSse — AI 配额门控 + 成功记账', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    vi.resetModules();
    mockAuth.mockReset();
    mockCheckAiQuota.mockReset();
    mockRecordAiUsage.mockReset().mockResolvedValue(undefined);
    mockSign.mockReset().mockResolvedValue({ 'X-Internal-Caller': 'cloud-bff' });
    mockResolveByok.mockReset().mockResolvedValue(null);
    mockInjectByok.mockReset().mockImplementation((raw: string) => ({ body: raw, injected: false }));
    globalThis.fetch = vi.fn().mockResolvedValue(sseStreamResponse());
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    vi.restoreAllMocks();
  });

  it('未登录 → 401，不检查配额也不转发', async () => {
    mockAuth.mockResolvedValue(null);
    const { proxyLlmSse } = await import('@/lib/llm-sse-proxy');
    const res = await proxyLlmSse(req() as never, { upstreamPath: '/api/v1/ai/generate' });
    expect(res.status).toBe(401);
    expect(mockCheckAiQuota).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('配额用尽 → 402，不 fetch 上游、不记账', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckAiQuota.mockResolvedValue({
      allowed: false,
      reason: 'ai_quota_exhausted',
      message: '本月 AI 配额已用尽',
    });
    const { proxyLlmSse } = await import('@/lib/llm-sse-proxy');
    const res = await proxyLlmSse(req() as never, { upstreamPath: '/api/v1/ai/generate' });
    expect(res.status).toBe(402);
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(mockRecordAiUsage).not.toHaveBeenCalled();
  });

  it('速率超限 → 429 + Retry-After，不转发', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckAiQuota.mockResolvedValue({
      allowed: false,
      reason: 'ai_rate_limited',
      message: '太频繁',
      retryAfterSec: 60,
    });
    const { proxyLlmSse } = await import('@/lib/llm-sse-proxy');
    const res = await proxyLlmSse(req() as never, { upstreamPath: '/api/v1/ai/generate' });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('放行 + 上游 2xx → 转发 SSE 流并记一笔 generate success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckAiQuota.mockResolvedValue({ allowed: true, remaining: 5, limit: 20, usedByok: false });
    const { proxyLlmSse } = await import('@/lib/llm-sse-proxy');
    const res = await proxyLlmSse(req() as never, { upstreamPath: '/api/v1/ai/generate' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(mockRecordAiUsage).toHaveBeenCalledTimes(1);
    expect(mockRecordAiUsage.mock.calls[0][0]).toMatchObject({
      userId: 'user-1',
      callKind: 'generate',
      status: 'success',
      usedByok: false,
    });
  });

  it('suggest 路径 → callKind 记为 suggest', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckAiQuota.mockResolvedValue({ allowed: true, remaining: 5, limit: 20, usedByok: false });
    const { proxyLlmSse } = await import('@/lib/llm-sse-proxy');
    const res = await proxyLlmSse(req() as never, { upstreamPath: '/api/v1/ai/suggest' });
    expect(res.status).toBe(200);
    expect(mockRecordAiUsage.mock.calls[0][0]).toMatchObject({ callKind: 'suggest' });
  });

  it('上游非 2xx → 透传错误，不记 success', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockCheckAiQuota.mockResolvedValue({ allowed: true, remaining: 5, limit: 20, usedByok: false });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response('{"error":"upstream"}', { status: 502, headers: { 'content-type': 'application/json' } })
    );
    const { proxyLlmSse } = await import('@/lib/llm-sse-proxy');
    const res = await proxyLlmSse(req() as never, { upstreamPath: '/api/v1/ai/generate' });
    expect(res.status).toBe(502);
    expect(mockRecordAiUsage).not.toHaveBeenCalled();
  });

  it('BYOK 用户 → checkAiQuota 收 usedByok=true、body 注入 _byok、记账 usedByok=true', async () => {
    mockAuth.mockResolvedValue({ user: { id: 'user-1' } });
    mockResolveByok.mockResolvedValue({ provider: 'anthropic', apiKey: 'sk-ant', bindingId: 'b1' });
    mockInjectByok.mockImplementation((raw: string) => ({
      body: JSON.stringify({ ...JSON.parse(raw), _byok: { provider: 'anthropic', apiKey: 'sk-ant' } }),
      injected: true,
    }));
    mockCheckAiQuota.mockResolvedValue({ allowed: true, remaining: -1, limit: -1, usedByok: true });

    const { proxyLlmSse } = await import('@/lib/llm-sse-proxy');
    const res = await proxyLlmSse(req() as never, { upstreamPath: '/api/v1/ai/generate' });
    expect(res.status).toBe(200);
    expect(mockCheckAiQuota).toHaveBeenCalledWith('user-1', { usedByok: true });
    const forwardedBody = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string;
    expect(JSON.parse(forwardedBody)._byok).toEqual({ provider: 'anthropic', apiKey: 'sk-ant' });
    expect(mockRecordAiUsage.mock.calls[0][0]).toMatchObject({ usedByok: true });
  });
});
