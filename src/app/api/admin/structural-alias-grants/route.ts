import { NextResponse } from 'next/server';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { requireLicenseWriteOk } from '@/lib/license-write-gate';
import { db, structuralAliasGrants, users } from '@/lib/prisma';

export async function GET() {
  const check = await requireAdmin();
  if (check instanceof NextResponse) return check;

  const rows = await db
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      grantId: structuralAliasGrants.id,
      grantedBy: structuralAliasGrants.grantedBy,
      grantedAt: structuralAliasGrants.grantedAt,
    })
    .from(users)
    .leftJoin(
      structuralAliasGrants,
      and(
        eq(structuralAliasGrants.userId, users.id),
        isNull(structuralAliasGrants.revokedAt),
      ),
    )
    .orderBy(desc(users.createdAt));

  return NextResponse.json({
    users: rows.map((row) => ({
      userId: row.userId,
      email: row.email,
      name: row.name,
      granted: Boolean(row.grantId),
      grantId: row.grantId,
      grantedBy: row.grantedBy,
      grantedAt: row.grantedAt,
    })),
  });
}

export async function POST(req: Request) {
  const writeGate = await requireLicenseWriteOk();
  if (writeGate) return writeGate;

  const check = await requireAdmin();
  if (check instanceof NextResponse) return check;

  const body = (await req.json()) as { userId?: unknown };
  if (typeof body.userId !== 'string' || !body.userId.trim()) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  // 幂等授予：先查活跃授权，无则插。check-then-insert 存在并发窗口——两个并发请求可能
  // 都过 !existing 检查同时插入。W3 的 partial UNIQUE(userId) WHERE revokedAt IS NULL 会让
  // 第二条 insert 抛唯一冲突（Postgres code 23505）；此处捕获并当作已授予（幂等），
  // 而非冒泡成 500。授予是「至多一条活跃」语义，重复请求返回成功即正确。
  const existing = await db.query.structuralAliasGrants.findFirst({
    where: and(
      eq(structuralAliasGrants.userId, body.userId),
      isNull(structuralAliasGrants.revokedAt),
    ),
    columns: { id: true },
  });
  if (!existing) {
    try {
      await db.insert(structuralAliasGrants).values({
        id: crypto.randomUUID(),
        userId: body.userId,
        grantedBy: check.userId,
      });
    } catch (err) {
      // 唯一冲突（并发另一个请求已插入活跃授权）→ 视为已授予，保持幂等。其余错误上抛。
      const code = (err as { code?: string })?.code;
      if (code !== '23505') throw err;
    }
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const writeGate = await requireLicenseWriteOk();
  if (writeGate) return writeGate;

  const check = await requireAdmin();
  if (check instanceof NextResponse) return check;

  const body = (await req.json()) as { userId?: unknown };
  if (typeof body.userId !== 'string' || !body.userId.trim()) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  await db
    .update(structuralAliasGrants)
    .set({ revokedAt: new Date() })
    .where(and(
      eq(structuralAliasGrants.userId, body.userId),
      isNull(structuralAliasGrants.revokedAt),
    ));

  return NextResponse.json({ ok: true });
}
