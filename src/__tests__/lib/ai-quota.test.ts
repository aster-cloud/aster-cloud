import { describe, it, expect, vi, beforeEach } from 'vitest';

// Hoisted mocks（与现有 usage.test.ts 模式一致）
const { mockSelect, mockInsertValues, mockInsert } = vi.hoisted(() => {
  const mockInsertValues = vi.fn().mockResolvedValue(undefined);
  const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
  const mockSelect = vi.fn();
  return { mockSelect, mockInsertValues, mockInsert };
});

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      users: { findFirst: vi.fn() },
      aiKeyBindings: { findFirst: vi.fn() },
    },
    select: mockSelect,
    insert: mockInsert,
  },
  users: { id: {}, plan: {} },
  aiUsageRecords: { id: {}, userId: {}, periodMonth: {}, status: {}, usedByok: {}, createdAt: {}, promptTokens: {}, completionTokens: {} },
  aiKeyBindings: { id: {}, userId: {}, active: {} },
}));

import { db } from '@/lib/prisma';
import { checkAiQuota, recordAiUsage, AI_MONTHLY_QUOTA, AI_RATE_LIMIT_PER_MINUTE } from '@/lib/ai-quota';

/**
 * 给 db.select().from().where() 链路返回固定 count 的结果
 */
function setupCountResult(count: number) {
  const mockWhere = vi.fn().mockResolvedValue([{ c: count }]);
  const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

/**
 * 给 db.select 链路返回多个不同 count（按调用次数顺序）
 */
function setupSequentialCounts(...counts: number[]) {
  let i = 0;
  mockSelect.mockImplementation(() => ({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockResolvedValue([{ c: counts[i++] ?? 0 }]),
    }),
  }));
}

// 用 any 避免和完整 User shape 类型对齐（测试只关心 ai-quota 用的字段）
function mockUserBase(overrides: Partial<Record<string, unknown>> = {}): any {
  return {
    id: 'user-1',
    plan: 'free' as const,
    priceLockedAt: null,
    legacyTier: null,
    aiBannedUntil: null,
    aiBanReason: null,
    // 默认已验证邮箱，避免触发 L0.5 邮箱验证守卫
    emailVerified: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

describe('checkAiQuota', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.aiKeyBindings.findFirst).mockResolvedValue(undefined);
  });

  describe('BYOK 优先级', () => {
    it('用户绑定 BYOK 时直接放行，不查配额', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUserBase({ plan: 'free' }));
      vi.mocked(db.query.aiKeyBindings.findFirst).mockResolvedValue({
        id: 'k1',
        provider: 'openai',
      } as any);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.usedByok).toBe(true);
        expect(result.limit).toBe(-1);
      }
      // 没调用 select（因为 BYOK 跳过配额查询）
      expect(mockSelect).not.toHaveBeenCalled();
    });
  });

  describe('自动封禁', () => {
    it('aiBannedUntil 在未来时拒绝并返回 retryAfterSec', async () => {
      const banUntil = new Date(Date.now() + 60_000); // 60s later
      vi.mocked(db.query.users.findFirst).mockResolvedValue(
        mockUserBase({ plan: 'free', aiBannedUntil: banUntil, aiBanReason: '滥用检测' })
      );

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('ai_banned');
        expect(result.message).toContain('滥用检测');
        expect(result.retryAfterSec).toBeGreaterThan(0);
        expect(result.retryAfterSec).toBeLessThanOrEqual(60);
      }
    });

    it('aiBannedUntil 在过去时不阻止', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(
        mockUserBase({ plan: 'free', aiBannedUntil: new Date(Date.now() - 60_000) })
      );
      // monthly count 0 / lastMinute 0 / lastHour 0 / final monthly 0
      setupSequentialCounts(0, 0, 0, 0);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(true);
    });
  });

  describe('月度次数配额', () => {
    it('Free 档当月用了 19 次 < 20 → 放行', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUserBase({ plan: 'free' }));
      // monthly 19 / lastMinute 0 / lastHour 0 / final monthly 19
      setupSequentialCounts(19, 0, 0, 19);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.limit).toBe(20);
        expect(result.remaining).toBe(1);
      }
    });

    it('Free 档当月用满 20 次 → 拒绝', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUserBase({ plan: 'free' }));
      setupCountResult(20); // monthly

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('ai_quota_exhausted');
        expect(result.message).toContain('20');
      }
    });

    it('Enterprise 档无限额 → 跳过月度配额检查', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUserBase({ plan: 'enterprise' }));
      // 跳过 monthly 检查；先 lastMinute 0 / lastHour 0 / final monthly 0
      setupSequentialCounts(0, 0, 0);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.limit).toBe(-1);
        expect(result.remaining).toBe(-1);
      }
    });

    it('Pro 档配额 500 / 月', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUserBase({ plan: 'pro' }));
      setupCountResult(500); // 满

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('ai_quota_exhausted');
        expect(result.message).toContain('500');
      }
    });
  });

  describe('速率限制', () => {
    it('Free 每分钟超 5 次 → 限流', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUserBase({ plan: 'free' }));
      // monthly 0 (放行) / lastMinute 5 (满)
      setupSequentialCounts(0, 5);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('ai_rate_limited');
        expect(result.retryAfterSec).toBe(60);
      }
    });

    it('Free 每小时超 20 次 → 限流', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(mockUserBase({ plan: 'free' }));
      // monthly 0 / lastMinute 0 / lastHour 20
      setupSequentialCounts(0, 0, 20);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('ai_rate_limited');
        expect(result.retryAfterSec).toBe(3600);
      }
    });
  });

  describe('用户不存在', () => {
    it('找不到用户 → 拒绝', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(undefined);
      const result = await checkAiQuota('ghost');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('ai_quota_exhausted');
      }
    });
  });

  describe('邮箱验证守卫（L5）', () => {
    it('Free + 未验证邮箱 → ai_email_unverified 拒绝', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(
        mockUserBase({ plan: 'free', emailVerified: null })
      );

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.reason).toBe('ai_email_unverified');
        expect(result.message).toContain('邮箱验证');
      }
      // 守卫触发后不应进入配额查询
      expect(mockSelect).not.toHaveBeenCalled();
    });

    it('Free + 已验证邮箱 → 正常走配额', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(
        mockUserBase({ plan: 'free', emailVerified: new Date('2026-01-01') })
      );
      setupSequentialCounts(0, 0, 0, 0);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.limit).toBe(20);
      }
    });

    it('Trial + 未验证邮箱 → 不被守卫拦截（trial 用户已通过 OAuth）', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(
        mockUserBase({ plan: 'trial', emailVerified: null })
      );
      setupSequentialCounts(0, 0, 0, 0);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(true);
    });

    it('BYOK 用户即使未验证邮箱也可使用（自带 key）', async () => {
      vi.mocked(db.query.users.findFirst).mockResolvedValue(
        mockUserBase({ plan: 'free', emailVerified: null })
      );
      vi.mocked(db.query.aiKeyBindings.findFirst).mockResolvedValue({
        id: 'k1',
        provider: 'openai',
      } as any);

      const result = await checkAiQuota('user-1');
      expect(result.allowed).toBe(true);
      if (result.allowed) {
        expect(result.usedByok).toBe(true);
      }
    });
  });
});

describe('recordAiUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('成功调用记录 success status + cost 估算', async () => {
    await recordAiUsage({
      userId: 'user-1',
      callKind: 'complete',
      model: 'gpt-4o-mini',
      promptTokens: 1000,
      completionTokens: 500,
      usedByok: false,
      status: 'success',
    });

    expect(mockInsert).toHaveBeenCalled();
    const values = mockInsertValues.mock.calls[0][0];
    expect(values.userId).toBe('user-1');
    expect(values.callKind).toBe('complete');
    expect(values.model).toBe('gpt-4o-mini');
    expect(values.promptTokens).toBe(1000);
    expect(values.completionTokens).toBe(500);
    expect(values.usedByok).toBe(false);
    expect(values.status).toBe('success');
    // gpt-4o-mini 价格：(1000/1M)*$0.15 + (500/1M)*$0.60 = $0.00015 + $0.0003 = $0.00045
    // → 0.045 cents → ceil 1 cent
    expect(values.costCents).toBe(1);
  });

  it('BYOK 调用 usedByok=true', async () => {
    await recordAiUsage({
      userId: 'user-1',
      callKind: 'generate',
      model: 'gpt-4o-mini',
      promptTokens: 100,
      completionTokens: 50,
      usedByok: true,
      status: 'success',
    });

    const values = mockInsertValues.mock.calls[0][0];
    expect(values.usedByok).toBe(true);
  });

  it('GPT-4 大调用成本估算正确', async () => {
    await recordAiUsage({
      userId: 'user-1',
      callKind: 'generate',
      model: 'gpt-4',
      promptTokens: 1_000_000, // 1M
      completionTokens: 500_000, // 500k
      usedByok: false,
      status: 'success',
    });

    const values = mockInsertValues.mock.calls[0][0];
    // gpt-4: $30/M prompt + $60/M completion
    // = $30 + $30 = $60 = 6000 cents
    expect(values.costCents).toBe(6000);
  });

  it('未知模型回退到 gpt-4o-mini 价位', async () => {
    await recordAiUsage({
      userId: 'user-1',
      callKind: 'generate',
      model: 'mystery-model',
      promptTokens: 1000,
      completionTokens: 500,
      usedByok: false,
      status: 'success',
    });

    const values = mockInsertValues.mock.calls[0][0];
    expect(values.costCents).toBe(1); // 与 gpt-4o-mini 同价
  });

  it('periodMonth 为 YYYY-MM 格式', async () => {
    await recordAiUsage({
      userId: 'user-1',
      callKind: 'complete',
      model: 'gpt-4o-mini',
      promptTokens: 100,
      completionTokens: 50,
      usedByok: false,
      status: 'success',
    });

    const values = mockInsertValues.mock.calls[0][0];
    expect(values.periodMonth).toMatch(/^\d{4}-\d{2}$/);
  });
});

describe('AI_MONTHLY_QUOTA / AI_RATE_LIMIT 常量与 PM 文档对齐', () => {
  it('Free 20 / Pro 500 / Enterprise 无限', () => {
    expect(AI_MONTHLY_QUOTA.free).toBe(20);
    expect(AI_MONTHLY_QUOTA.pro).toBe(500);
    expect(AI_MONTHLY_QUOTA.enterprise).toBe(-1);
  });

  it('每分钟 Free 5 / Pro 30 / Enterprise 200', () => {
    expect(AI_RATE_LIMIT_PER_MINUTE.free).toBe(5);
    expect(AI_RATE_LIMIT_PER_MINUTE.pro).toBe(30);
    expect(AI_RATE_LIMIT_PER_MINUTE.enterprise).toBe(200);
  });
});
