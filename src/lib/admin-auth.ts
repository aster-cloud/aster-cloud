/**
 * 单点 admin 判定。
 *
 * 当前判定：user.plan === 'enterprise'。
 * 这是临时方案（与 api/admin/ai-circuit-breaker 一致），生产应换成
 * 专门 role 字段（roles[] 或 isAdmin boolean）+ Authentik group claim。
 *
 * 抽到这里是为了未来切换 role 字段时**只改这一处**。
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/prisma';
import { users } from '@/db/schema';
import { eq } from 'drizzle-orm';

export interface AdminContext {
  userId: string;
}

export async function requireAdmin(): Promise<AdminContext | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const u = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { plan: true },
  });
  if (!u || u.plan !== 'enterprise') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return { userId: session.user.id };
}

/** 用在 server component 里：通过返回 boolean + 触发 redirect/notFound */
export async function isAdminFromSession(): Promise<{ userId: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  const u = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { plan: true },
  });
  if (!u || u.plan !== 'enterprise') return null;
  return { userId: session.user.id };
}
