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
  | 'binding-mismatch'
  | 'missing'
  | 'clock-rollback';

/**
 * Clock-rollback tolerance: how much time the wall clock is allowed
 * to move backwards before we conclude tampering. NTP jitter, leap
 * seconds, and VM-snapshot restoration can all legitimately rewind
 * the clock by small amounts; we want to catch a deliberate "rewind
 * a year to un-expire the license" without false-positive on a
 * 30-second NTP correction.
 *
 * 5 minutes covers every realistic legitimate rewind we've seen
 * (max observed in the field: VM resume after 3 min suspension on
 * a host with drifted NTP).
 */
const CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;

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
  // binding-mismatch 单独上报，方便 admin 看到 banner 时知道是哪类问题
  // （ASTER_DEPLOYMENT_ID 缺失 vs license 被搬到错的部署上）。
  if (result.trustStatus === 'binding-mismatch') {
    return { gated: true, reason: 'binding-mismatch' };
  }
  if (result.trustStatus !== 'verified') return { gated: true, reason: 'malformed' };
  if (result.entitlementStatus === 'revoked') return { gated: true, reason: 'revoked' };
  if (result.entitlementStatus === 'expired') return { gated: true, reason: 'expired' };
  if (result.displayStatus === 'network-grace-expired') {
    return { gated: true, reason: 'grace-expired' };
  }
  return { gated: false };
}

/**
 * Detects a wall-clock rewind larger than the tolerance. We compare
 * "now" against the latest `updated_at` we observed on the licence
 * cache row — that timestamp is monotonic-ish because every revocation
 * refresh (success OR failure) bumps it, and the cron runs every
 * 6 hours. If the clock jumps back further than tolerance behind that
 * witness, something is wrong: either a malicious operator is trying
 * to un-expire a licence, or the host VM lost time to a degree that
 * exceeds anything we've ever seen legitimately.
 *
 * Returns true = clock looks rolled back → caller should fail-closed.
 * Returns false = clock is fine, or we have no witness yet (cold
 * start with no refresh ever run).
 *
 * Read-only: this does NOT update any DB row. The witness is
 * established by the revocation refresh cron (see
 * src/lib/license-revocation.ts). Bootstrapping a malicious host with
 * a pre-rolled clock + no prior refresh row is still possible — but
 * the next refresh cycle establishes the witness and any subsequent
 * rollback gets caught. This is "shoplifting protection", not "vault
 * door".
 */
async function detectClockRollback(): Promise<boolean> {
  try {
    const cache = await db.query.licenseCache.findFirst({
      where: eq(licenseCache.id, 'current'),
      columns: { updatedAt: true },
    });
    if (!cache?.updatedAt) return false; // no witness yet
    const witnessMs = cache.updatedAt.getTime();
    const nowMs = Date.now();
    return nowMs < witnessMs - CLOCK_ROLLBACK_TOLERANCE_MS;
  } catch {
    // DB unreachable → fail-soft on the rollback check; the verify
    // path will independently fail-closed if it can't read state.
    return false;
  }
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

  // Check clock-rollback BEFORE verify. If the system clock is way
  // behind our last DB witness, the verify result is untrustworthy
  // anyway (e.g. computeEntitlement would resurrect an expired
  // licence). Gate read-only and skip the rest.
  if (await detectClockRollback()) {
    const rollbackGate: LicenseRuntimeGateResult = {
      gated: true,
      reason: 'clock-rollback',
    };
    recordLicenseReadOnlyGate('clock-rollback');
    CACHE.clear();
    CACHE.set(key, rollbackGate);
    return rollbackGate;
  }

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
