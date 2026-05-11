import { describe, it, expect } from 'vitest';
import { isDisposableEmail } from '@/lib/email-disposable';

describe('isDisposableEmail', () => {
  describe('一次性邮箱（命中）', () => {
    it('mailinator.com', () => {
      expect(isDisposableEmail('foo@mailinator.com')).toBe(true);
    });

    it('10minutemail.com', () => {
      expect(isDisposableEmail('user@10minutemail.com')).toBe(true);
    });

    it('大小写不敏感', () => {
      expect(isDisposableEmail('USER@MAILINATOR.COM')).toBe(true);
    });

    it('带 +suffix 仍能识别域名', () => {
      expect(isDisposableEmail('user+spam@mailinator.com')).toBe(true);
    });
  });

  describe('正常邮箱（不命中）', () => {
    it('gmail.com', () => {
      expect(isDisposableEmail('user@gmail.com')).toBe(false);
    });

    it('aster-lang.dev', () => {
      expect(isDisposableEmail('founder@aster-lang.dev')).toBe(false);
    });

    it('企业域名', () => {
      expect(isDisposableEmail('admin@anthropic.com')).toBe(false);
    });
  });

  describe('边界', () => {
    it('空字符串', () => {
      expect(isDisposableEmail('')).toBe(false);
    });

    it('无 @', () => {
      expect(isDisposableEmail('not-an-email')).toBe(false);
    });

    it('@ 在开头（空 local-part）→ 视为无效，返回 false', () => {
      // 不是合法邮箱，签到层会拒绝；不进入黑名单逻辑
      expect(isDisposableEmail('@mailinator.com')).toBe(false);
    });

    it('@ 后空白被剥离', () => {
      expect(isDisposableEmail('user@ mailinator.com ')).toBe(true);
    });
  });
});
