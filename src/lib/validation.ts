/**
 * 团队和资源的通用验证工具
 */

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * 验证团队名称
 * - 长度：2-50 个字符
 */
export function validateTeamName(name: unknown): ValidationResult {
  if (typeof name !== 'string') {
    return { valid: false, error: '团队名称必须是字符串' };
  }
  if (name.length < 2 || name.length > 50) {
    return { valid: false, error: '团队名称必须是 2-50 个字符' };
  }
  return { valid: true };
}

/**
 * 验证 slug（URL 友好标识符）
 * - 长度：2-50 个字符
 * - 只允许小写字母、数字和连字符
 * - 不能以连字符开头或结尾
 * - 不能包含连续的连字符
 */
export function validateSlug(slug: unknown): ValidationResult {
  if (typeof slug !== 'string') {
    return { valid: false, error: 'Slug 必须是字符串' };
  }
  if (slug.length < 2 || slug.length > 50) {
    return { valid: false, error: 'Slug 必须是 2-50 个字符' };
  }
  // 只允许小写字母、数字和连字符
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return { valid: false, error: 'Slug 只能包含小写字母、数字和连字符' };
  }
  // 不能以连字符开头或结尾
  if (slug.startsWith('-') || slug.endsWith('-')) {
    return { valid: false, error: 'Slug 不能以连字符开头或结尾' };
  }
  // 不能包含连续的连字符
  if (slug.includes('--')) {
    return { valid: false, error: 'Slug 不能包含连续的连字符' };
  }
  return { valid: true };
}

/**
 * 生成 slug（从名称自动生成）
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-') // 非字母数字替换为连字符
    .replace(/^-+|-+$/g, '') // 移除首尾连字符
    .replace(/-{2,}/g, '-') // 合并连续连字符
    .substring(0, 50);
}
