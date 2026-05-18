// requireLicenseWriteOk 行为：
//   - gated → 503 + { error: 'license-read-only-mode', reason }
//   - not gated → null（允许 caller 继续）

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isLicenseReadOnlyGated: vi.fn(),
}));

vi.mock('@/lib/license-runtime-gate', () => ({
  isLicenseReadOnlyGated: mocks.isLicenseReadOnlyGated,
}));

import { requireLicenseWriteOk } from '@/lib/license-write-gate';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireLicenseWriteOk', () => {
  it('not gated → null（允许写）', async () => {
    mocks.isLicenseReadOnlyGated.mockResolvedValueOnce({ gated: false });
    const result = await requireLicenseWriteOk();
    expect(result).toBeNull();
  });

  it('gated grace-expired → 503 + reason', async () => {
    mocks.isLicenseReadOnlyGated.mockResolvedValueOnce({
      gated: true,
      reason: 'grace-expired',
    });
    const result = await requireLicenseWriteOk();
    expect(result).not.toBeNull();
    expect(result!.status).toBe(503);
    await expect(result!.json()).resolves.toEqual({
      error: 'license-read-only-mode',
      reason: 'grace-expired',
    });
  });

  it.each(['missing', 'malformed', 'revoked', 'expired'] as const)(
    'gated %s → 503',
    async (reason) => {
      mocks.isLicenseReadOnlyGated.mockResolvedValueOnce({ gated: true, reason });
      const result = await requireLicenseWriteOk();
      expect(result!.status).toBe(503);
      await expect(result!.json()).resolves.toMatchObject({ reason });
    },
  );
});
