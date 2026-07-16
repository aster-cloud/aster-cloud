// BYOK 管理接口（PATCH 编辑额度/失效日期 + 重置额度 + 重排优先级；DELETE 按 id 撤销；
// POST 多 key 新增）授权与审计测试。
//
// 关注最敏感的安全路径：
//   - PATCH 编辑按 (id, userId) 双校验：越权/不存在统一 404，不泄露存在性。
//   - resetQuota 只改本人水位线，且**不删** aiUsageRecords（审计记录不可变）。
//   - reorder 校验 orderedIds（非空/唯一/字符串），只改本人，审计记 id 顺序。
//   - DELETE 按 id（多 key）；审计 deleted 区分真删/空删。
//   - 审计 metadata **绝不**含明文 key（apiKey / encryptedKey）。

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/lib/ai-key-vault', () => ({
  saveBYOKKey: vi.fn(),
  deleteBYOKKey: vi.fn(),
  updateBYOKKeyMeta: vi.fn(),
  reorderBYOKKeys: vi.fn(),
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
import { saveBYOKKey, deleteBYOKKey, updateBYOKKeyMeta, reorderBYOKKeys } from '@/lib/ai-key-vault';
import { resetByokQuotaUsage } from '@/lib/ai-quota';
import { logAuditEvent } from '@/lib/audit-log';

function patchReq(body: unknown) {
  return new Request('http://localhost/api/user/ai-keys', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof PATCH>[0];
}
function deleteReq(id: string | null) {
  const url = id
    ? `http://localhost/api/user/ai-keys?id=${encodeURIComponent(id)}`
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

describe('PATCH /api/user/ai-keys — 重排优先级（限定 provider 组）', () => {
  it('action=reorder + provider + 合法 orderedIds（全改到）→ 调 reorderBYOKKeys + 审计', async () => {
    vi.mocked(reorderBYOKKeys).mockResolvedValue(2); // 改到 2 行 == orderedIds.length
    const r = await PATCH(patchReq({ action: 'reorder', provider: 'openai', orderedIds: ['b2', 'b1'] }));
    expect(r.status).toBe(200);
    expect(reorderBYOKKeys).toHaveBeenCalledWith('user-1', 'openai', ['b2', 'b1']);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.reorder');
    expect(entry.metadata).toMatchObject({ provider: 'openai', orderedIds: ['b2', 'b1'] });
  });

  it('★改到的行数 != orderedIds.length（含越权/跨 provider id）→ 404，不写成功审计', async () => {
    vi.mocked(reorderBYOKKeys).mockResolvedValue(1); // 只改到 1 行，但传了 2 个 id
    const r = await PATCH(patchReq({ action: 'reorder', provider: 'openai', orderedIds: ['mine', 'foreign'] }));
    expect(r.status).toBe(404);
    expect(logAuditEvent).not.toHaveBeenCalled();
  });

  it('缺 provider → 400（不调 vault）', async () => {
    const r = await PATCH(patchReq({ action: 'reorder', orderedIds: ['b1', 'b2'] }));
    expect(r.status).toBe(400);
    expect(reorderBYOKKeys).not.toHaveBeenCalled();
  });

  it('orderedIds 为空数组 → 400（不调 vault）', async () => {
    const r = await PATCH(patchReq({ action: 'reorder', provider: 'openai', orderedIds: [] }));
    expect(r.status).toBe(400);
    expect(reorderBYOKKeys).not.toHaveBeenCalled();
  });

  it('orderedIds 有重复 id → 400（防 CASE 歧义）', async () => {
    const r = await PATCH(patchReq({ action: 'reorder', provider: 'openai', orderedIds: ['b1', 'b1'] }));
    expect(r.status).toBe(400);
    expect(reorderBYOKKeys).not.toHaveBeenCalled();
  });

  it('orderedIds 含非字符串 → 400', async () => {
    const r = await PATCH(patchReq({ action: 'reorder', provider: 'openai', orderedIds: ['b1', 123] }));
    expect(r.status).toBe(400);
    expect(reorderBYOKKeys).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/user/ai-keys — 按 id 撤销', () => {
  it('缺 id → 400', async () => {
    const r = await DELETE(deleteReq(null));
    expect(r.status).toBe(400);
  });

  it('删到行 → 审计 deleted=true + provider + keyHint', async () => {
    vi.mocked(deleteBYOKKey).mockResolvedValue({ deleted: true, provider: 'openai', keyHint: '9999' });
    const r = await DELETE(deleteReq('b1'));
    expect(r.status).toBe(200);
    // 按 (id, userId) 删
    expect(deleteBYOKKey).toHaveBeenCalledWith('user-1', 'b1');
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.delete');
    expect(entry.metadata).toMatchObject({ bindingId: 'b1', provider: 'openai', deleted: true, keyHint: '9999' });
  });

  it('无匹配行（越权别人 id / 已删）→ 审计 deleted=false', async () => {
    vi.mocked(deleteBYOKKey).mockResolvedValue({ deleted: false, provider: null, keyHint: null });
    await DELETE(deleteReq('someone-elses'));
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.metadata).toMatchObject({ deleted: false });
  });
});

describe('POST /api/user/ai-keys — 多 key 新增', () => {
  const goodKey = 'sk-'.padEnd(24, 'x');

  it('新增 → ai-key.create + 返回 id，审计不含明文 key', async () => {
    vi.mocked(saveBYOKKey).mockResolvedValue({ id: 'new-binding-1' });
    const r = await POST(postReq({ provider: 'openai', apiKey: goodKey }));
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, id: 'new-binding-1' });
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.create');
    expect(entry.metadata).toMatchObject({ bindingId: 'new-binding-1', provider: 'openai' });
    // 绝不记明文 key
    expect(JSON.stringify(entry.metadata)).not.toContain(goodKey);
  });

  it('同 provider 再加一个 → 仍是 create（多 key，不再 replace）', async () => {
    vi.mocked(saveBYOKKey).mockResolvedValue({ id: 'new-binding-2' });
    const r = await POST(postReq({ provider: 'openai', apiKey: goodKey }));
    expect(r.status).toBe(200);
    const entry = vi.mocked(logAuditEvent).mock.calls[0][0];
    expect(entry.action).toBe('ai-key.create');
  });
});
