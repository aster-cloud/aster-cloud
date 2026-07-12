import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCompile } = vi.hoisted(() => ({ mockCompile: vi.fn() }));

// PolicyApiError 真实类要用（instanceof 判 statusCode），只 mock compile 方法。
vi.mock('@/services/policy/policy-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/policy/policy-api')>();
  return {
    ...actual,
    createPolicyApiClient: vi.fn(() => ({ compile: mockCompile })),
  };
});

import { makeCompileValidator } from '@/lib/policy-compile-validator';
import { PolicyApiError } from '@/services/policy/policy-api';
import { PolicyCompileError } from '@/services/policy/version-manager';

describe('makeCompileValidator — 异常分类', () => {
  beforeEach(() => vi.clearAllMocks());
  const input = { source: 'Module X.', locale: 'en-US' };

  it('成功 → 返回上游 diagnostics', async () => {
    mockCompile.mockResolvedValue({ success: false, diagnostics: [{ severity: 'error' }] });
    const v = makeCompileValidator('u1');
    const r = await v(input);
    expect(r.diagnostics).toEqual([{ severity: 'error' }]);
  });

  it('上游 4xx（如 aliasSet 超限）→ 抛 PolicyCompileError（拒绝，不 fail-open）', async () => {
    mockCompile.mockRejectedValue(new PolicyApiError('alias_set_too_large', 400));
    const v = makeCompileValidator('u1');
    await expect(v(input)).rejects.toBeInstanceOf(PolicyCompileError);
  });

  it('上游 5xx → 原样上抛（由 createVersion fail-open）', async () => {
    const err = new PolicyApiError('server error', 503);
    mockCompile.mockRejectedValue(err);
    const v = makeCompileValidator('u1');
    await expect(v(input)).rejects.toBe(err);
  });

  it('408/TIMEOUT（超时）→ 原样上抛 fail-open，不当 4xx 用户错误拒绝', async () => {
    const err = new PolicyApiError('Request timeout', 408, 'TIMEOUT');
    mockCompile.mockRejectedValue(err);
    const v = makeCompileValidator('u1');
    // 不应被转成 PolicyCompileError（那会误拒合法保存）；原样上抛走 fail-open。
    await expect(v(input)).rejects.toBe(err);
  });

  it('网络/超时（非 PolicyApiError）→ 原样上抛', async () => {
    const err = new Error('network down');
    mockCompile.mockRejectedValue(err);
    const v = makeCompileValidator('u1');
    await expect(v(input)).rejects.toBe(err);
  });

  it('有别名时透传 aliasSet 给 client.compile', async () => {
    mockCompile.mockResolvedValue({ success: true, diagnostics: [] });
    const v = makeCompileValidator('u1');
    await v({ ...input, aliasSet: { TIMES: ['multiplied by'] } });
    expect(mockCompile).toHaveBeenCalledWith(
      expect.objectContaining({ aliasSet: { TIMES: ['multiplied by'] } }),
    );
  });
});
