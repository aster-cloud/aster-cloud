/**
 * 测试 auth-denial 的 cookie 往返与 reason 校验。
 *
 * mock next/headers 的 cookies()，因为 Vitest 环境里没有 Next request 上下文。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type CookieRecord = { name: string; value: string; maxAge?: number };

const cookieStore = new Map<string, CookieRecord>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => {
      const c = cookieStore.get(name);
      return c ? { name: c.name, value: c.value } : undefined;
    },
    set: (name: string, value: string, opts?: { maxAge?: number }) => {
      cookieStore.set(name, { name, value, maxAge: opts?.maxAge });
    },
  }),
}));

describe('auth-denial', () => {
  beforeEach(() => {
    cookieStore.clear();
  });

  it('newDenialRef returns 16 hex chars', async () => {
    const { newDenialRef } = await import('@/lib/auth-denial');
    const a = newDenialRef();
    const b = newDenialRef();
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toMatch(/^[0-9a-f]{16}$/);
    expect(a).not.toBe(b);
  });

  it('markDenial writes cookie + returns ref', async () => {
    const { markDenial } = await import('@/lib/auth-denial');
    const ref = await markDenial('signup_rate_limit', {
      email: 'a@b.com',
      ip: '1.2.3.4',
      provider: 'github',
    });
    expect(ref).toMatch(/^[0-9a-f]{16}$/);

    const c = cookieStore.get('aster_auth_denial');
    expect(c).toBeDefined();
    const parsed = JSON.parse(c!.value);
    expect(parsed.reason).toBe('signup_rate_limit');
    expect(parsed.ref).toBe(ref);
    expect(typeof parsed.ts).toBe('number');
  });

  it('readDenial returns payload (read-only, does not clear)', async () => {
    const { markDenial, readDenial } = await import('@/lib/auth-denial');
    const ref = await markDenial('disposable_email');

    const first = await readDenial();
    expect(first).not.toBeNull();
    expect(first!.reason).toBe('disposable_email');
    expect(first!.ref).toBe(ref);

    // Server Component 不能写 cookie：read 不应清除，等浏览器 maxAge 自然过期。
    // 第二次读应返回同样的 payload。
    const second = await readDenial();
    expect(second).not.toBeNull();
    expect(second!.ref).toBe(ref);
  });

  it('readDenial returns null on no cookie', async () => {
    const { readDenial } = await import('@/lib/auth-denial');
    const result = await readDenial();
    expect(result).toBeNull();
  });

  it('readDenial returns null on malformed JSON', async () => {
    cookieStore.set('aster_auth_denial', { name: 'aster_auth_denial', value: 'not-json{' });
    const { readDenial } = await import('@/lib/auth-denial');
    const result = await readDenial();
    expect(result).toBeNull();
  });

  it('readDenial returns null on missing required fields', async () => {
    cookieStore.set('aster_auth_denial', {
      name: 'aster_auth_denial',
      value: JSON.stringify({ reason: 'foo' }), // 缺 ref + ts
    });
    const { readDenial } = await import('@/lib/auth-denial');
    const result = await readDenial();
    expect(result).toBeNull();
  });

  it('readDenial returns null on stale timestamp (>60s old)', async () => {
    cookieStore.set('aster_auth_denial', {
      name: 'aster_auth_denial',
      value: JSON.stringify({
        reason: 'signup_rate_limit',
        ref: 'abc1234567890def',
        ts: Math.floor(Date.now() / 1000) - 120, // 2 分钟前
      }),
    });
    const { readDenial } = await import('@/lib/auth-denial');
    const result = await readDenial();
    expect(result).toBeNull();
  });

  it('readAndClearDenial alias is exported for backward compat', async () => {
    const m = await import('@/lib/auth-denial');
    expect(m.readAndClearDenial).toBe(m.readDenial);
  });

  it('markDenial handles cookies() unavailability gracefully', async () => {
    // 临时让 cookies() 抛错
    vi.doMock('next/headers', () => ({
      cookies: async () => {
        throw new Error('headers() called outside request scope');
      },
    }));
    vi.resetModules();
    const { markDenial } = await import('@/lib/auth-denial');
    // 不应抛出，应该返回 ref 仅打日志
    const ref = await markDenial('unknown');
    expect(ref).toMatch(/^[0-9a-f]{16}$/);

    // 恢复 mock 给后续测试
    vi.doMock('next/headers', () => ({
      cookies: async () => ({
        get: (name: string) => {
          const c = cookieStore.get(name);
          return c ? { name: c.name, value: c.value } : undefined;
        },
        set: (name: string, value: string, opts?: { maxAge?: number }) => {
          cookieStore.set(name, { name, value, maxAge: opts?.maxAge });
        },
      }),
    }));
    vi.resetModules();
  });
});
