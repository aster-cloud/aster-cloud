// /admin/license — on-prem 企业版 license 状态页。
//
// 服务端 verifyLicenseKey（Ed25519 签名 + revocation cache）→ 渲染 v2 UI。
// SaaS build：notFound（CAN_LICENSE = false）。
// admin layout 已守门 admin 权限；此页 defense-in-depth 重复检查。

import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { isAdminFromSession } from '@/lib/admin-auth';
import { CAN_LICENSE } from '@/lib/deployment-mode';
import { db, licenseCache } from '@/lib/prisma';
import { verifyLicenseKey, type RevocationState } from '@/lib/license';
import { evaluateGracePeriod } from '@/lib/license-revocation';
import { LicenseStatusContent, type LicenseCacheMeta } from './license-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;
const GRACE_WINDOW_MS = 7 * DAY_MS;

export default async function LicensePage({ params }: Props) {
  if (!CAN_LICENSE) {
    notFound();
  }

  // Defense-in-depth：与 PR-3 + PR-4 同模式 —— admin/layout.tsx 守
  // admin 权限是主守门，但叶子页也独立检查一遍。
  const admin = await isAdminFromSession();
  if (!admin) {
    notFound();
  }

  const { locale } = await params;
  setRequestLocale(locale);

  const { revocationState, cacheMeta } = await loadCacheAsRevocationState();
  const result = await verifyLicenseKey(process.env.LICENSE_KEY, {
    revocationState,
  });

  return <LicenseStatusContent result={result} cacheMeta={cacheMeta} />;
}

export const metadata = {
  title: 'License',
};

/**
 * 把 license_cache 行翻译成 verifier 需要的 RevocationState + UI 需要的
 * cacheMeta（含 relative 分钟数）。
 *
 * Fail-soft：DB 不可达时返回 null，让 verifier 按"无 revocation 信息"渲染
 * （connectivityStatus = not-applicable）—— 比让整个页面 500 更友好。
 */
async function loadCacheAsRevocationState(): Promise<{
  revocationState: RevocationState | null;
  cacheMeta: LicenseCacheMeta | null;
}> {
  try {
    const now = new Date();
    const cache = await db.query.licenseCache.findFirst({
      where: eq(licenseCache.id, 'current'),
    });

    if (!cache) {
      return { revocationState: null, cacheMeta: null };
    }

    const connectivity = evaluateGracePeriod(
      {
        licenseId: cache.licenseId,
        isRevoked: cache.isRevoked,
        revocationFetchedAt: cache.revocationFetchedAt ?? undefined,
        lastSuccessfulRevocationCheckAt:
          cache.lastSuccessfulRevocationCheckAt ?? undefined,
      },
      now,
    );
    const lastSuccessful = cache.lastSuccessfulRevocationCheckAt;
    const lastAttempt = cache.revocationFetchedAt;
    // grace 窗口结束时间 = 上次成功 + 7d（仅在 grace / grace-expired 状态下有意义）
    const graceEndedAt = lastSuccessful
      ? new Date(lastSuccessful.getTime() + GRACE_WINDOW_MS)
      : undefined;

    return {
      revocationState: {
        isRevoked: cache.isRevoked,
        revokedAt: cache.revokedAt?.toISOString(),
        revokedReason: cache.revokedReason ?? undefined,
        revocationVersion: cache.revocationVersion ?? undefined,
        lastCheckAt: lastSuccessful?.toISOString(),
        lastError: formatLastRevocationError(cache.lastRevocationError),
        connectivityStatus: connectivity,
      },
      cacheMeta: {
        lastSuccessfulRevocationCheckAt: lastSuccessful?.toISOString(),
        lastRevocationAttemptAt: lastAttempt?.toISOString(),
        lastCheckMinutesAgo: lastSuccessful
          ? Math.max(
              0,
              Math.floor((now.getTime() - lastSuccessful.getTime()) / 60000),
            )
          : undefined,
        graceEndedAt: graceEndedAt?.toISOString(),
      },
    };
  } catch {
    return { revocationState: null, cacheMeta: null };
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
