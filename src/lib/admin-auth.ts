/**
 * 单点 admin 判定。
 *
 * 判定依据：user.isAdmin === true（drizzle migration 0006 添加的字段）。
 *
 * 与套餐 plan 完全解耦 —— enterprise 套餐客户**不会**自动成为平台 admin。
 * 唯一授予方式：DBA 在 PG 上手动 `UPDATE "User" SET "isAdmin"=true WHERE ...`。
 *
 * 抽到这里是为了未来扩展角色模型（如 multi-role array、Authentik group
 * claim）时只改这一处。
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
    columns: { isAdmin: true },
  });
  if (!u?.isAdmin) {
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
    columns: { isAdmin: true },
  });
  if (!u?.isAdmin) return null;
  return { userId: session.user.id };
}
