/**
 * 兼容性层 - 重新导出 Auth.js v5 配置
 *
 * 为了向后兼容，保留此文件作为旧 API 的别名
 * 所有新代码应直接从 @/auth 导入
 */
export {
  auth,
  signIn,
  signOut,
  handlers,
  getSession,
  getCurrentUser,
  requireAuth,
  hashPassword,
  verifyPassword,
} from '@/auth';

// 兼容旧代码中使用的 getAuthOptions
// Auth.js v5 不再需要这个函数
export function getAuthOptions() {
  console.warn('[Auth] getAuthOptions() is deprecated in Auth.js v5. Use auth() instead.');
  return {};
}

// 兼容旧代码中使用的 authOptions
export const authOptions = {};
