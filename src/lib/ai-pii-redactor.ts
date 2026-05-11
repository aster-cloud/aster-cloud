// PII 脱敏：把原始 prompt 里的敏感信息替换成 [REDACTED:TYPE]
//
// 设计：
//   - 接口 PiiRedactor 可插拔，v1 是 RegexPiiRedactor（regex-only，<5ms）
//   - 漏检不阻塞业务，由 anomaly detection + 加密原文（180 天）兜底
//   - 永久存储用，参与内容安全分类训练样本（脱敏后才能用）
//
// 覆盖类型（v1）：
//   - email          foo@bar.com
//   - phone-cn       +86 13800138000 / 138-0013-8000
//   - phone-intl     E.164 通用
//   - id-cn          18 位身份证
//   - credit-card    13-19 位（覆盖 Visa/MC/Amex/银联）
//   - ipv4           1.2.3.4
//   - bearer-token   Authorization: Bearer xxx
//   - api-key        sk-xxx / api_key=xxx
//
// 详见 aster-deploy/docs/pm/07-ai-billing.md "内容审计 — PII 脱敏"

export interface PiiRedactor {
  redact(text: string): string;
}

interface RedactRule {
  type: string;
  pattern: RegExp;
}

/**
 * 默认 v1 实现：regex-based。
 * 漏检场景留给后续可插拔实现（小模型分类器）兜底。
 */
export class RegexPiiRedactor implements PiiRedactor {
  // 顺序敏感（先匹配的优先 redact）：
  //   1. 高熵 token（API key / Bearer）— 长且独特，最不容易冲突
  //   2. 邮箱（含 @ 不与数字模式冲突）
  //   3. 中国身份证（18 位以 X 结尾或全数字，必须先于信用卡，否则会被 CC 抢走）
  //   4. 信用卡（13-19 位数字）
  //   5. 中国手机（11 位数字开头 1[3-9]）
  //   6. 国际电话（+ 开头）
  //   7. IPv4（四段点分）
  private static readonly RULES: ReadonlyArray<RedactRule> = [
    {
      type: 'BEARER',
      pattern: /\b(Bearer|Basic)\s+[A-Za-z0-9._\-+/=]{16,}\b/g,
    },
    {
      type: 'API_KEY',
      pattern: /\b(sk|pk|rk|api[_-]?key)[-_=:]\s*[A-Za-z0-9_\-]{16,}\b/gi,
    },
    {
      type: 'EMAIL',
      pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    },
    {
      type: 'ID_CN',
      pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    },
    {
      type: 'CREDIT_CARD',
      // 13-19 位，可带 - 或空格分隔；用断言确保前后不是数字（避免吃掉 ID 末尾）
      pattern: /(?<![\d-])(?:\d{4}[\s-]?){3,4}\d{1,4}(?![\d-])/g,
    },
    {
      type: 'PHONE_CN',
      pattern: /(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}\b/g,
    },
    {
      type: 'PHONE_INTL',
      pattern: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/g,
    },
    {
      type: 'IPV4',
      pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/g,
    },
  ];

  redact(text: string): string {
    if (!text || typeof text !== 'string') return text;
    let result = text;
    for (const rule of RegexPiiRedactor.RULES) {
      result = result.replace(rule.pattern, `[REDACTED:${rule.type}]`);
    }
    return result;
  }
}

export const defaultPiiRedactor: PiiRedactor = new RegexPiiRedactor();

/**
 * 业务路径便捷函数
 */
export function redactPii(text: string, redactor: PiiRedactor = defaultPiiRedactor): string {
  return redactor.redact(text);
}
