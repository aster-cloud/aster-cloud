/**
 * GET /api/admin/license — returns v2 LicenseResult (signed verification +
 * revocation cache) for the on-prem admin console. SaaS mode: 404.
 *
 * 鉴权：必须是 admin 用户。on-prem 部署的 admin 也是单个组织的 IT/owner，
 * 与 SaaS admin gate 共用 isAdminFromSession（PR-3 已建立的语义）。
 *
 * 响应 shape：v2 LicenseResult（trustStatus + entitlementStatus +
 * connectivityStatus + displayStatus + secondaryAdvisories + diagnostics）。
 */

import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { isAdminFromSession } from '@/lib/admin-auth';
import { CAN_LICENSE } from '@/lib/deployment-mode';
import { db, licenseCache } from '@/lib/prisma';
import { verifyLicenseKey, type RevocationState } from '@/lib/license';
import { evaluateGracePeriod } from '@/lib/license-revocation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // SaaS build 不该有此路由；优先于 admin 检查不泄露端点存在
  if (!CAN_LICENSE) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = await isAdminFromSession();
  if (!admin) {
    return new NextResponse(null, { status: 404 });
  }

  const revocationState = await loadCacheAsRevocationState();
  const result = await verifyLicenseKey(process.env.LICENSE_KEY, {
    revocationState,
  });

  // bigint 不能 JSON.stringify，转 string
  const serialized = JSON.parse(
    JSON.stringify(result, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );

  return NextResponse.json(serialized, {
    // 运营敏感配置 —— 不允许任何中间层缓存
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function loadCacheAsRevocationState(): Promise<RevocationState | null> {
  try {
    const cache = await db.query.licenseCache.findFirst({
      where: eq(licenseCache.id, 'current'),
    });
    if (!cache) return null;

    const connectivity = evaluateGracePeriod(
      {
        licenseId: cache.licenseId,
        isRevoked: cache.isRevoked,
        revocationFetchedAt: cache.revocationFetchedAt ?? undefined,
        lastSuccessfulRevocationCheckAt:
          cache.lastSuccessfulRevocationCheckAt ?? undefined,
      },
      new Date(),
    );
    return {
      isRevoked: cache.isRevoked,
      revokedAt: cache.revokedAt?.toISOString(),
      revokedReason: cache.revokedReason ?? undefined,
      revocationVersion: cache.revocationVersion ?? undefined,
      lastCheckAt: cache.lastSuccessfulRevocationCheckAt?.toISOString(),
      lastError: formatLastRevocationError(cache.lastRevocationError),
      connectivityStatus: connectivity,
    };
  } catch {
    return null;
  }
}

function formatLastRevocationError(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
