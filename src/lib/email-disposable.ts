// 一次性邮箱黑名单：拦截 mailinator / 10minutemail / temp-mail.org 等
//
// 数据源：disposable-email-domains（社区维护，~120k 域名）
// 注意：此列表是滚动更新的，但版本固定在 package.json，可被测试覆盖
//
// 详见 aster-deploy/docs/pm/07-ai-billing.md "反多重注册" 章节

import disposableList from 'disposable-email-domains';

const DISPOSABLE_SET: Set<string> = new Set(disposableList);

/**
 * 判断邮箱是否一次性
 *
 * @param email 任意大小写、可含空格、可含 +suffix
 * @returns true = 命中黑名单
 */
export function isDisposableEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const atIdx = email.lastIndexOf('@');
  if (atIdx <= 0) return false;
  const host = email.slice(atIdx + 1).trim().toLowerCase();
  if (!host) return false;
  return DISPOSABLE_SET.has(host);
}
