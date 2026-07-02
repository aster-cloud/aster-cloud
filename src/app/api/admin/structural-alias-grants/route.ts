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

  const existing = await db.query.structuralAliasGrants.findFirst({
    where: and(
      eq(structuralAliasGrants.userId, body.userId),
      isNull(structuralAliasGrants.revokedAt),
    ),
    columns: { id: true },
  });
  if (!existing) {
    await db.insert(structuralAliasGrants).values({
      id: crypto.randomUUID(),
      userId: body.userId,
      grantedBy: check.userId,
    });
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
