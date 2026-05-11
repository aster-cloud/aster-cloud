import { describe, it, expect } from 'vitest';
import { redactPii, RegexPiiRedactor } from '@/lib/ai-pii-redactor';

describe('redactPii / RegexPiiRedactor', () => {
  describe('邮箱', () => {
    it('普通邮箱', () => {
      expect(redactPii('contact me at foo@bar.com')).toContain('[REDACTED:EMAIL]');
    });

    it('邮箱不应被信用卡 regex 误伤', () => {
      const result = redactPii('foo@bar.com');
      expect(result).toBe('[REDACTED:EMAIL]');
    });
  });

  describe('电话', () => {
    it('中国手机号（无前缀）', () => {
      expect(redactPii('call 13800138000')).toContain('[REDACTED:PHONE_CN]');
    });

    it('中国手机号（带 +86）', () => {
      expect(redactPii('+86 13800138000')).toContain('[REDACTED:PHONE_CN]');
    });

    it('中国手机号（带 - 分隔）', () => {
      expect(redactPii('138-0013-8000')).toContain('[REDACTED:PHONE_CN]');
    });

    it('国际号 E.164', () => {
      expect(redactPii('+1 415 555 1234')).toContain('[REDACTED:');
    });
  });

  describe('身份证', () => {
    it('18 位身份证（结尾数字）', () => {
      expect(redactPii('身份证 110101199001011234')).toContain('[REDACTED:ID_CN]');
    });

    it('18 位身份证（结尾 X）', () => {
      expect(redactPii('身份证 11010119900101123X')).toContain('[REDACTED:ID_CN]');
    });
  });

  describe('信用卡', () => {
    it('Visa 16 位', () => {
      expect(redactPii('card 4242424242424242')).toContain('[REDACTED:CREDIT_CARD]');
    });

    it('Amex 15 位', () => {
      expect(redactPii('card 378282246310005')).toContain('[REDACTED:CREDIT_CARD]');
    });

    it('带空格分组', () => {
      expect(redactPii('4242 4242 4242 4242')).toContain('[REDACTED:CREDIT_CARD]');
    });
  });

  describe('IP 地址', () => {
    it('IPv4', () => {
      expect(redactPii('server 192.168.1.100')).toContain('[REDACTED:IPV4]');
    });

    it('IPv4 边界（255.255.255.255）', () => {
      expect(redactPii('255.255.255.255')).toBe('[REDACTED:IPV4]');
    });

    it('非合法 IP（256 段）→ 不脱敏', () => {
      expect(redactPii('256.1.1.1')).not.toContain('[REDACTED:IPV4]');
    });
  });

  describe('Token / API Key', () => {
    it('Bearer token', () => {
      expect(redactPii('Authorization: Bearer abcdef1234567890ghij')).toContain(
        '[REDACTED:BEARER]'
      );
    });

    it('OpenAI sk- key', () => {
      expect(redactPii('key=sk-abc123def456ghi789jkl')).toContain('[REDACTED:API_KEY]');
    });

    it('api_key= 格式', () => {
      expect(redactPii('api_key=xxxxxxxxxxxxxxxx')).toContain('[REDACTED:API_KEY]');
    });
  });

  describe('多类型混合', () => {
    it('一个 prompt 含多种 PII，全部脱敏', () => {
      const input =
        'contact foo@bar.com or 13800138000, my id 110101199001011234, server 192.168.1.1';
      const result = redactPii(input);
      expect(result).toContain('[REDACTED:EMAIL]');
      expect(result).toContain('[REDACTED:PHONE_CN]');
      expect(result).toContain('[REDACTED:ID_CN]');
      expect(result).toContain('[REDACTED:IPV4]');
      expect(result).not.toContain('foo@bar.com');
      expect(result).not.toContain('13800138000');
    });
  });

  describe('正常文本（不脱敏）', () => {
    it('普通中文', () => {
      expect(redactPii('请生成一个检查用户年龄的策略')).toBe('请生成一个检查用户年龄的策略');
    });

    it('普通英文', () => {
      expect(redactPii('Generate a policy for age verification.')).toBe(
        'Generate a policy for age verification.'
      );
    });

    it('空字符串', () => {
      expect(redactPii('')).toBe('');
    });
  });

  describe('可插拔接口', () => {
    it('自定义 redactor 替换默认实现', () => {
      const custom = { redact: (t: string) => t.replace(/foo/g, '[X]') };
      expect(redactPii('foo bar', custom)).toBe('[X] bar');
    });

    it('独立实例化 RegexPiiRedactor', () => {
      const r = new RegexPiiRedactor();
      expect(r.redact('foo@bar.com')).toBe('[REDACTED:EMAIL]');
    });
  });
});
