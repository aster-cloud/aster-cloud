import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * byok-envelope 单测（Phase 2）：resolveByokEnvelope（provider allowlist + 解密失败回退）
 * 与 injectByokEnvelope（剥离 caller _byok + 注入服务端 envelope）。
 */

const { mockFindFirst, mockGetDecrypted } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockGetDecrypted: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  db: { query: { aiKeyBindings: { findFirst: mockFindFirst } } },
  aiKeyBindings: { userId: {}, active: {} },
}));
vi.mock('drizzle-orm', () => ({
  and: (...a: unknown[]) => ({ op: 'and', a }),
  eq: (c: unknown, v: unknown) => ({ op: 'eq', c, v }),
}));
vi.mock('@/lib/ai-key-vault', () => ({ getDecryptedBYOKKey: mockGetDecrypted }));

import { resolveByokEnvelope, injectByokEnvelope } from '@/lib/byok-envelope';

describe('resolveByokEnvelope', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('无 active 绑定 → null（平台）', async () => {
    mockFindFirst.mockResolvedValue(undefined);
    expect(await resolveByokEnvelope('u1')).toBeNull();
  });

  it('openai 绑定 + 解密成功 → envelope（含 bindingId 供 stamp lastUsedAt）', async () => {
    mockFindFirst.mockResolvedValue({ id: 'binding-1', provider: 'openai' });
    mockGetDecrypted.mockResolvedValue('sk-user');
    expect(await resolveByokEnvelope('u1')).toEqual({
      provider: 'openai',
      apiKey: 'sk-user',
      bindingId: 'binding-1',
    });
  });

  it('★不支持的 provider（vertex）→ null（不接入推理，走平台）', async () => {
    mockFindFirst.mockResolvedValue({ provider: 'vertex' });
    expect(await resolveByokEnvelope('u1')).toBeNull();
    expect(mockGetDecrypted).not.toHaveBeenCalled();
  });

  it('★解密失败 → 抛错（fail-closed，让路由返回 503，不静默回退平台偷烧预算）', async () => {
    mockFindFirst.mockResolvedValue({ provider: 'anthropic' });
    mockGetDecrypted.mockRejectedValue(new Error('decrypt boom'));
    await expect(resolveByokEnvelope('u1')).rejects.toThrow('decrypt boom');
  });

  it('解密返回 null → null', async () => {
    mockFindFirst.mockResolvedValue({ provider: 'openai' });
    mockGetDecrypted.mockResolvedValue(null);
    expect(await resolveByokEnvelope('u1')).toBeNull();
  });
});

describe('injectByokEnvelope', () => {
  it('注入服务端 envelope 到顶层 _byok（只含 provider+apiKey，★bindingId 不转发给 aster-api）', () => {
    const out = injectByokEnvelope('{"goal":"x"}', { provider: 'openai', apiKey: 'sk', bindingId: 'b1' });
    expect(out.injected).toBe(true);
    // bindingId 是 cloud 内部字段（用于 stamp lastUsedAt），绝不进转发 body
    expect(JSON.parse(out.body)).toEqual({ goal: 'x', _byok: { provider: 'openai', apiKey: 'sk' } });
  });

  it('★剥离 caller 提交的 _byok（防浏览器注入），无 envelope 时不重新注入，injected=false', () => {
    const out = injectByokEnvelope('{"goal":"x","_byok":{"provider":"evil","apiKey":"attacker"}}', null);
    expect(out.injected).toBe(false);
    expect(JSON.parse(out.body)).toEqual({ goal: 'x' });
  });

  it('★caller 带 _byok + 服务端有 envelope → 用服务端的覆盖 caller 的', () => {
    const out = injectByokEnvelope(
      '{"goal":"x","_byok":{"provider":"evil","apiKey":"attacker"}}',
      { provider: 'openai', apiKey: 'real', bindingId: 'b1' }
    );
    expect(out.injected).toBe(true);
    expect(JSON.parse(out.body)._byok).toEqual({ provider: 'openai', apiKey: 'real' });
  });

  it('body 非 JSON → 原样返回、injected=false（避免"以为注入了"）', () => {
    const out = injectByokEnvelope('not-json', { provider: 'openai', apiKey: 'sk', bindingId: 'b1' });
    expect(out).toEqual({ body: 'not-json', injected: false });
  });
});
