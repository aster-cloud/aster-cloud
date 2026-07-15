// BYOK 管理接口（PATCH 编辑额度/失效日期 + 重置额度；DELETE 撤销）授权与审计测试。
//
// 关注最敏感的安全路径（Codex 审查建议补齐）：
//   - PATCH 编辑按 (id, userId) 双校验：越权/不存在统一 404，不泄露存在性。
//   - resetQuota 只改本人水位线，且**不删** aiUsageRecords（审计记录不可变）。
//   - 审计 metadata **绝不**含明文 key（apiKey / encryptedKey）。
//   - create vs replace 审计动作准确（upsert 语义）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/ai-key-vault', () => ({
  saveBYOKKey: vi.fn(),
  deleteBYOKKey: vi.fn(),
  updateBYOKKeyMeta: vi.fn(),
}));
vi.mock('@/lib/ai-quota', () => ({
  byokTokensUsedThisMonth: vi.fn().mockResolvedValue(0),
  resetByokQuotaUsage: vi.fn(),
}));
vi.mock('@/lib/audit-log', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
  extractClientInfo: vi.fn().mockReturnValue({ ipAddress: '1.2.3.4', userAgent: 'test' }),
}));

import { PATCH, DELETE, POST } from '@/app/api/user/ai-keys/route';
import { auth } from '@/auth';
import { saveBYOKKey, deleteBYOKKey, updateBYOKKeyMeta } from '@/lib/ai-key-vault';
import { resetByokQuotaUsage } from '@/lib/ai-quota';
import { logAuditEvent } from '@/lib/audit-log';

function patchReq(body: unknown) {
  return new Request('http://localhost/api/user/ai-keys', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof PATCH>[0];
}
function deleteReq(provider: string | null) {
  const url = provider
    ? `http://localhost/api/user/ai-keys?provider=${encodeURIComponent(provider)}`
    : 'http://localhost/api/user/ai-keys';
  return new Request(url, { method: 'DELETE' }) as unknown as Parameters<typeof DELETE>[0];
}
function postReq(body: unknown) {
  return new Request('http://localhost/api/user/ai-keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1' } } as never);
});

describe('PATCH /api/user/ai-keys — 编辑额度/失效日期', () => {
  it('未登录 → 401', async () => {
    vi.mocked(auth).mockResolvedValue(null as never);
    const r = await PATCH(patchReq({ id: 'b1', tokenQuota: 100 }));
    expect(r.status).toBe(401);
  });

  it('缺 id（非 reset）→ 400', async () => {
    const r = await PATCH(patchReq({ tokenQuota: 100 }));
    expect(r.status).toBe(400);
    expect(updateBYOKKeyMeta).not.toHaveBeenCalled();
  });

  it('tokenQuota 非正整数 → 400', async () => {
    const r = await PATCH(patchReq({ id: 'b1', tokenQuota: -5 }));
    expect(r.status).toBe(400);
    expect(updateBYOKKeyMeta).not.toHaveBeenCalled();
  });

  it('expiresAt 过去时间 → 400', async () => {
    const r = await PATCH(patchReq({ id: 'b1', expiresAt: '2000-01-01T00:00:00Z' }));
    expect(r.status).toBe(400);
  });

  it('既没 quota 也没 expiry → 400（无可改）', async () => {
    const r = await PATCH(patchReq({ id: 'b1' }));
    expect(r.status).toBe(400);
  });

  it('越权/不存在（vault 返回 null）→ 404，不泄露存在性', async () => {
    vi.mocked(updateBYOKKeyMeta).mockResolvedValue(null);
    const r = await PATCH(patchReq({ id: 'someone-elses', tokenQuota: 100 }));
    expect(r.status).toBe(404);
    // vault 用 (id, userId) 双条件——路由把当前 session userId 传入
    expect(updateBYOKKeyMeta).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user-1', bindingId: 'someone-elses' }),
    );
  });

  it('成功改额度 → 200 + 审计 ai-key.update，metadata 不含明文 key', async () => {
    vi.mocked(updateBYOKKeyMeta).mockResolvedValue({ provider: 'openai', keyHint: '1234' });
    const r = await PATCH(patchReq({ id: 'b1', tokenQuota: 500000 }));
    expect(r.status).toBe(200);

    expect(logAuditEvent).toHaveBeenCalledTimes(1);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.update');
    expect(entry.userId).toBe('user-1');
    const metaStr = JSON.stringify(entry.metadata);
    expect(metaStr).not.toMatch(/apiKey|encryptedKey|sk-/i);
    expect(entry.metadata).toMatchObject({ tokenQuota: 500000, keyHint: '1234' });
  });

  it('tokenQuota:null 清空（改无限）→ 透传 null 给 vault', async () => {
    vi.mocked(updateBYOKKeyMeta).mockResolvedValue({ provider: 'openai', keyHint: '1234' });
    await PATCH(patchReq({ id: 'b1', tokenQuota: null }));
    expect(updateBYOKKeyMeta).toHaveBeenCalledWith(
      expect.objectContaining({ tokenQuota: null }),
    );
  });
});

describe('PATCH /api/user/ai-keys — 重置额度', () => {
  it('action=resetQuota → 调 resetByokQuotaUsage（本人）+ 审计 reset-quota，不碰 vault delete', async () => {
    const stamped = new Date('2026-07-16T00:00:00Z');
    vi.mocked(resetByokQuotaUsage).mockResolvedValue(stamped);

    const r = await PATCH(patchReq({ action: 'resetQuota' }));
    expect(r.status).toBe(200);
    // 只针对本人 userId
    expect(resetByokQuotaUsage).toHaveBeenCalledWith('user-1');
    // 重置绝不删除 key
    expect(deleteBYOKKey).not.toHaveBeenCalled();
    // 审计动作准确
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.reset-quota');
    expect(entry.userId).toBe('user-1');
  });
});

describe('DELETE /api/user/ai-keys — 撤销', () => {
  it('缺 provider → 400', async () => {
    const r = await DELETE(deleteReq(null));
    expect(r.status).toBe(400);
  });

  it('删到行 → 审计 deleted=true + keyHint', async () => {
    vi.mocked(deleteBYOKKey).mockResolvedValue({ deleted: true, keyHint: '9999' });
    const r = await DELETE(deleteReq('openai'));
    expect(r.status).toBe(200);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.delete');
    expect(entry.metadata).toMatchObject({ provider: 'openai', deleted: true, keyHint: '9999' });
  });

  it('无匹配行（no-op）→ 审计 deleted=false（管理员能区分空删）', async () => {
    vi.mocked(deleteBYOKKey).mockResolvedValue({ deleted: false, keyHint: null });
    await DELETE(deleteReq('anthropic'));
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.metadata).toMatchObject({ deleted: false });
  });
});

describe('POST /api/user/ai-keys — create vs replace 审计准确', () => {
  const goodKey = 'sk-'.padEnd(24, 'x');

  it('首次绑定（replaced=false）→ ai-key.create', async () => {
    vi.mocked(saveBYOKKey).mockResolvedValue({ replaced: false });
    const r = await POST(postReq({ provider: 'openai', apiKey: goodKey }));
    expect(r.status).toBe(200);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.create');
    expect(entry.metadata).toMatchObject({ operation: 'created' });
    // 绝不记明文 key
    expect(JSON.stringify(entry.metadata)).not.toContain(goodKey);
  });

  it('替换既有（replaced=true）→ ai-key.update', async () => {
    vi.mocked(saveBYOKKey).mockResolvedValue({ replaced: true });
    const r = await POST(postReq({ provider: 'openai', apiKey: goodKey }));
    expect(r.status).toBe(200);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.update');
    expect(entry.metadata).toMatchObject({ operation: 'replaced' });
  });
});
