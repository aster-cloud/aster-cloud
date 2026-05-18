// On-prem read-only mode gate（grace-expired soft degradation）。
//
// 设计意图：
//   - **绝不锁用户登录** —— 那会让客户业务灾难性中断
//   - 只限制 /admin 写操作，迫使 operator 处理 license 问题
//   - SaaS 模式永远不 gate；只在 on-prem 启用
//   - 每分钟最多 verify 一次（CACHE）减少 DB 压力
//
// 状态映射：
//   trust=missing → gated (reason='missing')
//   trust !== verified → gated (reason='malformed')  覆盖 signature-invalid/untrusted/legacy
//   entitlement=revoked → gated (reason='revoked')
//   entitlement=expired → gated (reason='expired')
//   displayStatus='network-grace-expired' → gated (reason='grace-expired')
//   其余 → 不 gate（fresh / grace / expiring-soon 等仍可写）

import { eq } from 'drizzle-orm';
import { db, licenseCache } from '@/lib/prisma';
import { IS_SAAS } from '@/lib/deployment-mode';
import { verifyLicenseKey, type RevocationState } from '@/lib/license';
import { evaluateGracePeriod } from '@/lib/license-revocation';
import type { TrustBundleEntry } from '@/lib/license-trust-bundle';
import {
  recordLicenseReadOnlyGate,
  recordLicenseRuntimeGateCache,
} from '@/lib/license-metrics';

export type LicenseGateReason =
  | 'grace-expired'
  | 'revoked'
  | 'expired'
  | 'malformed'
  | 'missing';

export interface LicenseRuntimeGateResult {
  gated: boolean;
  reason?: LicenseGateReason;
}

const CACHE = new Map<string, LicenseRuntimeGateResult>();

// 测试专用 trust bundle override。生产路径 trustBundleOverride === null，
// verifyLicenseKey 走默认 ASTER_TRUST_BUNDLE。
// 仅 __setTrustBundleForTests 能写入；导出函数检查 vitest 标记防止生产误用。
let trustBundleOverride: readonly TrustBundleEntry[] | null = null;

function minuteKey(): string {
  return String(Math.floor(Date.now() / 60_000));
}

function formatError(value: unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

async function loadRevocationState(): Promise<RevocationState | null> {
  const cache = await db.query.licenseCache.findFirst({
    where: eq(licenseCache.id, 'current'),
  });
  if (!cache) return null;
  return {
    isRevoked: cache.isRevoked,
    revokedAt: cache.revokedAt?.toISOString(),
    revokedReason: cache.revokedReason ?? undefined,
    revocationVersion: cache.revocationVersion ?? undefined,
    lastCheckAt: cache.lastSuccessfulRevocationCheckAt?.toISOString(),
    lastError: formatError(cache.lastRevocationError),
    connectivityStatus: evaluateGracePeriod(
      {
        licenseId: cache.licenseId,
        isRevoked: cache.isRevoked,
        revocationFetchedAt: cache.revocationFetchedAt ?? undefined,
        lastSuccessfulRevocationCheckAt:
          cache.lastSuccessfulRevocationCheckAt ?? undefined,
      },
      new Date(),
    ),
  };
}

function gateFromStatus(
  result: Awaited<ReturnType<typeof verifyLicenseKey>>,
): LicenseRuntimeGateResult {
  if (result.trustStatus === 'missing') return { gated: true, reason: 'missing' };
  if (result.trustStatus !== 'verified') return { gated: true, reason: 'malformed' };
  if (result.entitlementStatus === 'revoked') return { gated: true, reason: 'revoked' };
  if (result.entitlementStatus === 'expired') return { gated: true, reason: 'expired' };
  if (result.displayStatus === 'network-grace-expired') {
    return { gated: true, reason: 'grace-expired' };
  }
  return { gated: false };
}

export async function isLicenseReadOnlyGated(): Promise<LicenseRuntimeGateResult> {
  if (IS_SAAS) return { gated: false };
  const key = minuteKey();
  const cached = CACHE.get(key);
  if (cached) {
    recordLicenseRuntimeGateCache('hit');
    return cached;
  }

  recordLicenseRuntimeGateCache('miss');
  let result: Awaited<ReturnType<typeof verifyLicenseKey>>;
  try {
    result = await verifyLicenseKey(process.env.LICENSE_KEY, {
      revocationState: await loadRevocationState(),
      ...(trustBundleOverride ? { trustBundle: trustBundleOverride } : {}),
    });
  } catch {
    // verify 抛错（不太可能；revocationState load 也已 fail-soft）→ 视为 missing
    return { gated: true, reason: 'missing' };
  }
  const gate = gateFromStatus(result);
  if (gate.gated && gate.reason) {
    recordLicenseReadOnlyGate(gate.reason);
  }
  // 单分钟桶 cache，跨分钟自动失效（避免无限累积）
  CACHE.clear();
  CACHE.set(key, gate);
  return gate;
}

export function __resetLicenseRuntimeGateCacheForTests(): void {
  CACHE.clear();
}

/**
 * 测试专用：注入 trust bundle 供 verifyLicenseKey 使用。传 null 还原默认行为。
 * 生产路径不应调用此函数 —— vitest 之外调用会 throw（fail-closed）。
 */
export function __setTrustBundleForTests(
  bundle: readonly TrustBundleEntry[] | null,
): void {
  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    throw new Error(
      '__setTrustBundleForTests called outside vitest/test runtime — refusing to override trust bundle in production code path',
    );
  }
  trustBundleOverride = bundle;
}
