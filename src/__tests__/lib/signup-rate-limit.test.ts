import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSelect, mockInsertValues, mockInsert } = vi.hoisted(() => {
  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  const mockSelect = vi.fn();
  return { mockSelect, mockInsertValues, mockInsert };
});

vi.mock('@/lib/prisma', () => ({
  db: { select: mockSelect, insert: mockInsert },
  signupAttempts: { id: {}, ipHash: {}, succeeded: {}, createdAt: {} },
}));

import {
  hashIp,
  checkSignupRateLimit,
  recordSignupAttempt,
} from '@/lib/signup-rate-limit';

function setupCount(count: number) {
  const mockWhere = vi.fn().mockResolvedValue([{ c: count }]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe('hashIp', () => {
  beforeEach(() => {
    process.env.SIGNUP_IP_SALT = 'test-salt-deterministic';
  });

  it('同一 IP + 同 salt → 相同 hash', () => {
    expect(hashIp('1.2.3.4')).toBe(hashIp('1.2.3.4'));
  });

  it('不同 IP → 不同 hash', () => {
    expect(hashIp('1.2.3.4')).not.toBe(hashIp('5.6.7.8'));
  });

  it('返回 16 字符前缀（不暴露完整 hash）', () => {
    expect(hashIp('1.2.3.4')).toHaveLength(16);
  });

  it('salt 改变 → hash 改变', () => {
    const a = hashIp('1.2.3.4');
    process.env.SIGNUP_IP_SALT = 'different-salt';
    const b = hashIp('1.2.3.4');
    expect(a).not.toBe(b);
  });
});

describe('checkSignupRateLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('IP 为 null → 允许（不阻止）', async () => {
    expect(await checkSignupRateLimit(null)).toBe(true);
    expect(await checkSignupRateLimit(undefined)).toBe(true);
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it('24h 内 0 次 → 允许', async () => {
    setupCount(0);
    expect(await checkSignupRateLimit('1.2.3.4')).toBe(true);
  });

  it('24h 内 2 次 → 允许（< 3）', async () => {
    setupCount(2);
    expect(await checkSignupRateLimit('1.2.3.4')).toBe(true);
  });

  it('24h 内 3 次 → 拒绝（达到上限）', async () => {
    setupCount(3);
    expect(await checkSignupRateLimit('1.2.3.4')).toBe(false);
  });

  it('24h 内 5 次 → 拒绝', async () => {
    setupCount(5);
    expect(await checkSignupRateLimit('1.2.3.4')).toBe(false);
  });
});

describe('recordSignupAttempt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('IP 为 null → 不写库（避免脏数据）', async () => {
    await recordSignupAttempt(null, true);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('记录成功的注册', async () => {
    await recordSignupAttempt('1.2.3.4', true);
    expect(mockInsert).toHaveBeenCalled();
    const values = mockInsertValues.mock.calls[0][0];
    expect(values.succeeded).toBe(true);
    expect(values.ipHash).toBeTruthy();
    expect(values.ipHash).not.toBe('1.2.3.4'); // 不存明文
  });

  it('记录失败的注册', async () => {
    await recordSignupAttempt('1.2.3.4', false);
    const values = mockInsertValues.mock.calls[0][0];
    expect(values.succeeded).toBe(false);
  });
});
