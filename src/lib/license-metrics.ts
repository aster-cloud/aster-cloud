// License observability metrics（Prometheus text exposition）。
//
// 设计意图：
//   - 低基数 label；licenseId/customer 等敏感字段绝不进入 label
//   - 独立 Registry，避免污染 prom-client default registry
//   - 多实例部署下为 per-instance metrics，由 Prometheus/Grafana 聚合

import { Counter, Gauge, Registry } from 'prom-client';
import type { EntitlementStatus, TrustStatus } from '@/lib/license';

const registry = new Registry();

const licenseVerifiedTotal = new Counter({
  name: 'aster_license_verified_total',
  help: 'License verification results by trust and entitlement status.',
  labelNames: ['trust_status', 'entitlement_status'] as const,
  registers: [registry],
});

const licenseRefreshTotal = new Counter({
  name: 'aster_license_refresh_total',
  help: 'License revocation refresh outcomes.',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

const licenseRuntimeGateCacheTotal = new Counter({
  name: 'aster_license_runtime_gate_cache_total',
  help: 'Read-only runtime gate cache hit/miss counts.',
  labelNames: ['result'] as const,
  registers: [registry],
});

const licenseReadOnlyGateTotal = new Counter({
  name: 'aster_license_read_only_gate_total',
  help: 'Read-only gate trigger count by reason.',
  labelNames: ['reason'] as const,
  registers: [registry],
});

const revokedLicensesActive = new Gauge({
  name: 'aster_license_revoked_active',
  help: 'Current count of actively revoked licenses.',
  registers: [registry],
});

const licenseCacheAgeSeconds = new Gauge({
  name: 'aster_license_cache_age_seconds',
  help: 'Seconds since last successful on-prem revocation check.',
  registers: [registry],
});

const revocationManifestVersion = new Gauge({
  name: 'aster_revocation_manifest_version',
  help: 'Latest published revocation manifest version.',
  registers: [registry],
});

export function recordLicenseVerification(
  trustStatus: TrustStatus,
  entitlementStatus: EntitlementStatus | null,
): void {
  licenseVerifiedTotal.inc({
    trust_status: trustStatus,
    entitlement_status: entitlementStatus ?? 'none',
  });
}

export function recordLicenseRefreshOutcome(outcome: string): void {
  licenseRefreshTotal.inc({ outcome });
}

export function recordLicenseRuntimeGateCache(result: 'hit' | 'miss'): void {
  licenseRuntimeGateCacheTotal.inc({ result });
}

export function recordLicenseReadOnlyGate(reason: string): void {
  licenseReadOnlyGateTotal.inc({ reason });
}

export function setRevokedLicensesActive(count: number): void {
  revokedLicensesActive.set(count);
}

export function setLicenseCacheAgeSeconds(seconds: number | null): void {
  licenseCacheAgeSeconds.set(seconds === null ? 0 : Math.max(0, Math.floor(seconds)));
}

export function setRevocationManifestVersion(version: bigint | number | null): void {
  if (version !== null) revocationManifestVersion.set(Number(version));
}

export async function renderLicenseMetrics(): Promise<string> {
  return registry.metrics();
}

export function licenseMetricsContentType(): string {
  return registry.contentType;
}
