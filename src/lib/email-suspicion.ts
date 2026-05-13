/**
 * 邮箱可疑度的启发式分析。
 *
 * 不依赖外部数据源（HIBP / emailrep.io），仅基于邮箱字符串本身的特征，
 * 用于 risk-tier 在 createUser 时叠加额外信号。
 *
 * 设计原则：
 *  - 低召回 + 高精度：宁可放过 9 个合成邮箱，不愿误伤 1 个真实用户
 *  - 不暴露评分细节给用户：避免攻击者按规则反推规避
 *  - 与 email-disposable.ts 互补（后者是黑名单域名，本模块是启发式特征）
 *
 * 启发式（每条命中加 1 分，>= 2 视为可疑）：
 *  - local part 全是数字
 *  - local part 长度 >= 20
 *  - local part 数字占比 >= 60%
 *  - local part 含连续 5+ 个相同字符
 *  - local part 是 base64 形 (字母 + 数字 + 长度 >= 16)
 */

export interface EmailSuspicionResult {
  suspicious: boolean;
  score: number;
  signals: string[];
}

export function analyzeEmailSuspicion(email: string): EmailSuspicionResult {
  const at = email.indexOf('@');
  if (at <= 0) return { suspicious: false, score: 0, signals: [] };
  const local = email.slice(0, at).toLowerCase();

  const signals: string[] = [];

  if (/^\d+$/.test(local)) signals.push('all_digits');

  if (local.length >= 20) signals.push('long_local');

  const digits = (local.match(/\d/g) ?? []).length;
  if (local.length > 0 && digits / local.length >= 0.6) signals.push('digit_heavy');

  if (/(.)\1{4,}/.test(local)) signals.push('repeated_chars');

  // base64-like: alphanum mix, no separator, >= 16 chars
  if (
    local.length >= 16 &&
    /^[a-z0-9]+$/.test(local) &&
    /[a-z]/.test(local) &&
    /\d/.test(local)
  ) {
    signals.push('base64_like');
  }

  const score = signals.length;
  return { suspicious: score >= 2, score, signals };
}
