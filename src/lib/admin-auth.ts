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
  // Wrap auth() + DB lookup in a try/catch so a transient failure
  // (Workers session decoder hiccup, Hyperdrive cold start, missing
  // env, etc.) returns a structured 401 instead of bubbling up as an
  // opaque "Internal Server Error". The original failure still lands
  // in the Worker log via console.error for on-call to investigate.
  //
  // Background: anonymous probes against /api/admin/risk-tier and
  // /api/admin/ai-circuit-breaker were producing 500s in production
  // (see aster-cloud security log around the admin-UI audit). The
  // auth() failure was indistinguishable from a logged-out user from
  // the caller's point of view — both deserve 401, not 500.
  try {
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
  } catch (err) {
    console.error('[requireAdmin] auth/db lookup failed', err);
    return NextResponse.json(
      { error: 'Unauthorized', reason: 'auth_failed' },
      { status: 401 },
    );
  }
}

/** 用在 server component 里：通过返回 boolean + 触发 redirect/notFound */
export async function isAdminFromSession(): Promise<{ userId: string } | null> {
  // Mirror requireAdmin's defensive try/catch — server components that
  // call this on the (dashboard)/admin/* route mustn't 500 the whole
  // segment when the underlying auth check throws. A null return ends
  // up as notFound() on those pages, which is the conservative default.
  try {
    const session = await auth();
    if (!session?.user?.id) return null;
    const u = await db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { isAdmin: true },
    });
    if (!u?.isAdmin) return null;
    return { userId: session.user.id };
  } catch (err) {
    console.error('[isAdminFromSession] auth/db lookup failed', err);
    return null;
  }
}
