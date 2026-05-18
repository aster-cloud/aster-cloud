/**
 * DELETE /api/admin/license-revoke/[licenseId] — 撤回 revocation（6h undo 窗口）。
 *
 * 设计意图：
 *   - 防止误操作：6 小时内可撤回；超出后必须重新走法律 / 销售流程
 *   - 撤回后重新 publish 新版 manifest（不在列表里 = 客户立即恢复访问）
 *   - audit log 记录 'license.revocation_undone' 事件
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, auditLogs, revokedLicenses } from '@/lib/prisma';
import { publishRevocationManifest } from '@/lib/revocation-publisher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UNDO_WINDOW_MS = 6 * 60 * 60 * 1000;
// codex 审查 Major-5：白名单防 path 注入 / 编码绕过
const LICENSE_ID_RE = /^lic_[A-Z0-9]{20,30}$/;

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ licenseId: string }> },
) {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const { licenseId: rawLicenseId } = await ctx.params;
  const licenseId = decodeURIComponent(rawLicenseId);
  if (!LICENSE_ID_RE.test(licenseId)) {
    return NextResponse.json({ error: 'invalid-license-id' }, { status: 400 });
  }
  const existing = await db.query.revokedLicenses.findFirst({
    where: eq(revokedLicenses.licenseId, licenseId),
  });
  if (!existing) {
    return NextResponse.json({ error: 'not-revoked' }, { status: 404 });
  }

  const now = new Date();
  if (existing.revokedAt.getTime() <= now.getTime() - UNDO_WINDOW_MS) {
    return NextResponse.json(
      {
        error: 'undo-window-expired',
        revokedAt: existing.revokedAt.toISOString(),
      },
      { status: 409 },
    );
  }

  await db.delete(revokedLicenses).where(eq(revokedLicenses.licenseId, licenseId));
  const publication = await publishRevocationManifest({ now });
  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    userId: admin.userId,
    action: 'license.revocation_undone',
    resource: 'license',
    resourceId: licenseId,
    metadata: {
      previousReason: existing.reason,
      publishedVersion: publication.version.toString(),
    },
    createdAt: now,
  });

  return NextResponse.json({
    licenseId,
    publishedVersion: publication.version.toString(),
  });
}
