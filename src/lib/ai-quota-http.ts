import type { AiQuotaResult } from '@/lib/ai-quota';

/**
 * 把 checkAiQuota 的拒绝 reason 映射为 HTTP 状态码 + 响应体，供 AI 请求代理前置门控复用。
 *
 * 语义：
 *   - ai_quota_exhausted → 402 Payment Required（月配额用尽，需升级/绑 key/等下月）
 *   - ai_rate_limited    → 429 Too Many Requests（速率超限，带 Retry-After）
 *   - ai_banned          → 403 Forbidden（风险封禁）
 *   - ai_email_unverified→ 403 Forbidden（未验证邮箱）
 */
export function aiQuotaHttpStatus(
  result: Extract<AiQuotaResult, { allowed: false }>
): { status: number; headers: Record<string, string> } {
  const headers: Record<string, string> = {};
  if (result.retryAfterSec != null) {
    headers['Retry-After'] = String(result.retryAfterSec);
  }
  switch (result.reason) {
    case 'ai_quota_exhausted':
      return { status: 402, headers };
    case 'ai_rate_limited':
      return { status: 429, headers };
    case 'ai_banned':
    case 'ai_email_unverified':
      return { status: 403, headers };
    default:
      return { status: 403, headers };
  }
}
