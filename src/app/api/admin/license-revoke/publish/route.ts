/**
 * POST /api/admin/license-revoke/publish — 强制重新发布 revocation manifest（SaaS only）。
 *
 * 用途：客户报告 on-prem 端 manifest version 落后 + 怀疑 cron 卡住，admin
 * 强制 publish 一次新版（即便 revoked 列表无变化）。
 *
 * 不接受 body；幂等（每次都分配新 version）。
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, auditLogs } from '@/lib/prisma';
import { publishRevocationManifest } from '@/lib/revocation-publisher';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const now = new Date();
  const publication = await publishRevocationManifest({ now });

  await db.insert(auditLogs).values({
    id: crypto.randomUUID(),
    userId: admin.userId,
    action: 'license.revocation_republished',
    resource: 'license-revocation-manifest',
    resourceId: publication.version.toString(),
    metadata: { reason: 'manual-republish' },
    createdAt: now,
  });

  return NextResponse.json({
    publishedVersion: publication.version.toString(),
    publishedAt: publication.publishedAt.toISOString(),
  });
}
