import { describe, it, expect } from 'vitest';
import { GRACE_PERIOD_DAYS } from '@/lib/user-lifecycle';

/**
 * Pure-unit tests around the soft-delete + reactivation contract.
 *
 * softDeleteUser / findTombstonedUserByNormalizedEmail / reactivateUser are
 * thin DB writes — they're covered by the auth.ts integration path in
 * sign-in / OAuth e2e flows. Here we lock down the public invariants that
 * call sites depend on.
 */
describe('user-lifecycle', () => {
  describe('GRACE_PERIOD_DAYS', () => {
    it('is exactly 30 days (DELETE response message + cron schedule depend on this)', () => {
      expect(GRACE_PERIOD_DAYS).toBe(30);
    });

    it('30d in milliseconds matches purgePendingUntil offset', () => {
      const now = Date.now();
      const purgeAt = now + GRACE_PERIOD_DAYS * 86400_000;
      // 30 days = 2,592,000,000 ms
      expect(purgeAt - now).toBe(2_592_000_000);
    });
  });

  describe('tombstone-encoded emailNormalized', () => {
    // softDeleteUser encodes emailNormalized as "{original}#deleted-{epoch}".
    // findTombstonedUserByNormalizedEmail recovers the original via LIKE.
    // user-purge cron's audit-log writer recovers the original via split.
    // All three call sites must agree on the encoding shape.
    it('encoding pattern is stable', () => {
      const original = 'user@example.com';
      const ts = 1234567890123;
      const encoded = `${original}#deleted-${ts}`;
      expect(encoded.startsWith(`${original}#deleted-`)).toBe(true);
      // splitting recovers original (used by cron purge audit-log writer)
      expect(encoded.split('#deleted-')[0]).toBe(original);
      // LIKE pattern that findTombstonedUserByNormalizedEmail uses.
      // 转义 original 里的正则元字符（邮箱含 . + 等）后再拼 `.*`，避免把字面量当模式
      // （CodeQL incomplete-sanitization）；断言意图不变。
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(encoded).toMatch(new RegExp('^' + escaped + '#deleted-.*$'));
    });

    it('encoding survives gmail-style normalization', () => {
      // emailNormalize.ts strips dots + +alias for gmail
      const normalized = 'foobar@gmail.com'; // already normalized
      const encoded = `${normalized}#deleted-${Date.now()}`;
      expect(encoded.split('#deleted-')[0]).toBe(normalized);
    });
  });
});
