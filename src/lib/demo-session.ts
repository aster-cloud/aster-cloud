/**
 * Demo 会话管理
 *
 * 提供基于 Cookie 的匿名 Demo 会话，无需用户注册即可体验 Aster Cloud 功能。
 * 会话数据存储在数据库中，24 小时后自动过期并被 Vercel Cron 清理。
 */

import { cookies, headers } from 'next/headers';
import { prisma } from '@/lib/prisma';

const DEMO_SESSION_COOKIE = 'aster-demo-session';
const DEMO_SESSION_TTL_HOURS = 24;
const MAX_POLICIES_PER_SESSION = 10;

export interface DemoSessionData {
  id: string;
  sessionId: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * 获取当前 Demo 会话
 * @returns Demo 会话数据，如果不存在或已过期则返回 null
 */
export async function getDemoSession(): Promise<DemoSessionData | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(DEMO_SESSION_COOKIE)?.value;

  if (!sessionId) {
    return null;
  }

  const session = await prisma.demoSession.findUnique({
    where: { sessionId },
  });

  // 检查是否过期
  if (session && session.expiresAt < new Date()) {
    // 清理过期会话（异步，不阻塞）
    prisma.demoSession.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  return session;
}

/**
 * 创建新的 Demo 会话
 * @returns 新创建的 Demo 会话数据
 */
export async function createDemoSession(): Promise<DemoSessionData> {
  const headersList = await headers();
  const ipAddress = headersList.get('x-forwarded-for')?.split(',')[0] || 'unknown';
  const userAgent = headersList.get('user-agent') || 'unknown';

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + DEMO_SESSION_TTL_HOURS);

  const session = await prisma.demoSession.create({
    data: {
      sessionId,
      ipAddress,
      userAgent,
      expiresAt,
    },
  });

  // 设置 Cookie
  const cookieStore = await cookies();
  cookieStore.set(DEMO_SESSION_COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: DEMO_SESSION_TTL_HOURS * 60 * 60,
    path: '/',
  });

  return session;
}

/**
 * 获取或创建 Demo 会话
 * 如果当前没有有效会话，则自动创建一个新的
 * @returns Demo 会话数据
 */
export async function requireDemoSession(): Promise<DemoSessionData> {
  let session = await getDemoSession();
  if (!session) {
    session = await createDemoSession();
  }
  return session;
}

/**
 * 获取 Demo 会话剩余时间（毫秒）
 * @param session Demo 会话数据
 * @returns 剩余毫秒数
 */
export function getSessionTimeRemaining(session: DemoSessionData): number {
  return Math.max(0, session.expiresAt.getTime() - Date.now());
}

/**
 * 获取 Demo 会话剩余时间（格式化字符串）
 * @param session Demo 会话数据
 * @returns 格式化的剩余时间，如 "23h 45m"
 */
export function formatTimeRemaining(session: DemoSessionData): string {
  const remaining = getSessionTimeRemaining(session);
  const hours = Math.floor(remaining / (1000 * 60 * 60));
  const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${minutes}m`;
}

/**
 * 检查是否可以创建更多策略
 * @param sessionId Demo 会话 ID
 * @returns 是否可以创建更多策略
 */
export async function canCreateMorePolicies(sessionId: string): Promise<boolean> {
  const count = await prisma.demoPolicy.count({
    where: { sessionId },
  });
  return count < MAX_POLICIES_PER_SESSION;
}

/**
 * 获取 Demo 会话的策略数量限制信息
 * @param sessionId Demo 会话 ID
 * @returns { current: number, max: number }
 */
export async function getPolicyLimitInfo(sessionId: string): Promise<{ current: number; max: number }> {
  const current = await prisma.demoPolicy.count({
    where: { sessionId },
  });
  return { current, max: MAX_POLICIES_PER_SESSION };
}

/**
 * 记录 Demo 审计日志
 * @param sessionId Demo 会话 ID
 * @param action 操作类型
 * @param resource 资源类型
 * @param resourceId 资源 ID
 * @param metadata 额外元数据
 */
export async function logDemoAudit(
  sessionId: string,
  action: string,
  resource: string,
  resourceId?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await prisma.demoAuditLog.create({
    data: {
      sessionId,
      action,
      resource,
      resourceId,
      metadata: (metadata as object) ?? undefined,
    },
  });
}

// 常量导出
export const DEMO_CONSTANTS = {
  SESSION_COOKIE: DEMO_SESSION_COOKIE,
  SESSION_TTL_HOURS: DEMO_SESSION_TTL_HOURS,
  MAX_POLICIES: MAX_POLICIES_PER_SESSION,
};
