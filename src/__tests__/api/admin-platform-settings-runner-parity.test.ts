/*
 * admin platform-settings POST：runner-parity 两 key 的写侧值级校验测试。
 * 非法 mode / 非法 pct → 400 且**绝不** setSetting；合法值 → setSetting 被调 + ok。
 * （读侧 getRunnerParityConfig 的 fail-closed 另有 runner-parity-config.test.ts；此处专测写侧 fail-fast。）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/admin-auth', () => ({ requireAdmin: vi.fn() }));
vi.mock('@/lib/license-write-gate', () => ({ requireLicenseWriteOk: vi.fn() }));
// ★vi.hoisted：vi.mock 工厂被提升到 import 之上，不能闭包引用后声明的 const。用 hoisted 提升 mock fn。
const { setSetting } = vi.hoisted(() => ({ setSetting: vi.fn(async () => {}) }));
vi.mock('@/lib/platform-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/platform-settings')>();
  return {
    ...actual, // 保留真实 PLATFORM_SETTING_KEYS / RUNNER_PARITY_MODES（route 用它们校验）
    setSetting,
    getSetting: vi.fn(async () => undefined),
  };
});

import { POST } from '@/app/api/admin/platform-settings/route';
import { requireAdmin } from '@/lib/admin-auth';
import { requireLicenseWriteOk } from '@/lib/license-write-gate';
import { PLATFORM_SETTING_KEYS } from '@/lib/platform-settings';

const MODE = PLATFORM_SETTING_KEYS.RUNNER_PARITY_MODE;
const PCT = PLATFORM_SETTING_KEYS.RUNNER_PARITY_SAMPLE_PCT;

function req(body: unknown) {
  return new Request('http://localhost/api/admin/platform-settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireLicenseWriteOk).mockResolvedValue(null);
  vi.mocked(requireAdmin).mockResolvedValue({ userId: 'admin-1' } as never);
});

describe('POST /api/admin/platform-settings — runner_parity.mode 校验', () => {
  it.each(['off', 'sampled', 'every', 'manual'])('合法 mode %s → 200 + setSetting', async (mode) => {
    const resp = await POST(req({ key: MODE, value: mode }));
    expect(resp.status).toBe(200);
    expect(setSetting).toHaveBeenCalledWith(MODE, mode, 'admin-1');
  });

  it.each([['garbage'], [123], [null], [{}], ['']])('非法 mode %o → 400 且不 setSetting', async (bad) => {
    const resp = await POST(req({ key: MODE, value: bad }));
    expect(resp.status).toBe(400);
    expect(setSetting).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/platform-settings — runner_parity.sample_pct 校验', () => {
  it.each([0, 5, 50, 100])('合法 pct %i → 200 + setSetting', async (pct) => {
    const resp = await POST(req({ key: PCT, value: pct }));
    expect(resp.status).toBe(200);
    expect(setSetting).toHaveBeenCalledWith(PCT, pct, 'admin-1');
  });

  it.each([[-1], [101], [7.5], ['50'], [null], [NaN]])('非法 pct %o → 400 且不 setSetting', async (bad) => {
    const resp = await POST(req({ key: PCT, value: bad }));
    expect(resp.status).toBe(400);
    expect(setSetting).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/platform-settings — 非 runner-parity key 不受新校验影响', () => {
  it('policy_sharing.enabled=true → 200（旧 key 行为不变）', async () => {
    const resp = await POST(req({ key: PLATFORM_SETTING_KEYS.POLICY_SHARING_ENABLED, value: true }));
    expect(resp.status).toBe(200);
    expect(setSetting).toHaveBeenCalledWith(PLATFORM_SETTING_KEYS.POLICY_SHARING_ENABLED, true, 'admin-1');
  });

  it('未知 key → 400（现有 whitelist 行为不变）', async () => {
    const resp = await POST(req({ key: 'bogus.key', value: 1 }));
    expect(resp.status).toBe(400);
    expect(setSetting).not.toHaveBeenCalled();
  });
});
