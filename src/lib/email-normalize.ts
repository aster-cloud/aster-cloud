// 邮箱规范化：消除"同一人多账号"漏洞
//
// 规则：
//   - gmail.com / googlemail.com：剥离 +xxx 后缀，去除 local-part 中的点
//     foo.bar+spam@gmail.com → foobar@gmail.com
//   - 其他域名：仅 toLowerCase（保留 local-part 原貌，因为大小写敏感性视服务而定，
//     但绝大多数邮件服务实际上不区分大小写，做 lower 不会误伤）
//
// 详见 aster-deploy/docs/pm/07-ai-billing.md "反多重注册" 章节

const GMAIL_HOSTS = new Set(['gmail.com', 'googlemail.com']);

/**
 * 把任意输入邮箱归一化为去重键。
 * 注意：此函数仅用于"是否是同一人"的判断，不替换原始 email 列存储。
 */
export function normalizeEmail(email: string): string {
  if (!email || typeof email !== 'string') return '';
  const trimmed = email.trim().toLowerCase();
  const atIdx = trimmed.lastIndexOf('@');
  if (atIdx <= 0) return trimmed;

  let local = trimmed.slice(0, atIdx);
  const host = trimmed.slice(atIdx + 1);

  // 剥离 +suffix（任何域名通用）
  const plusIdx = local.indexOf('+');
  if (plusIdx >= 0) local = local.slice(0, plusIdx);

  // gmail / googlemail：去除 local-part 中的点
  if (GMAIL_HOSTS.has(host)) {
    local = local.replace(/\./g, '');
    // googlemail.com 与 gmail.com 视为同一域
    return `${local}@gmail.com`;
  }

  return `${local}@${host}`;
}
