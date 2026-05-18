/**
 * POST /api/admin/license/refresh — admin 手动刷新 revocation cache。
 *
 * 与 cron route 复用 refreshLicenseRevocationCache()。鉴权走 session admin。
 * SaaS build 返回 404，避免泄露 on-prem-only endpoint 的存在。
 *
 * 响应：JSON `{ outcome, version, isRevoked, error? }`；no-store。
 */

import { NextResponse } from 'next/server';
import { isAdminFromSession } from '@/lib/admin-auth';
import { CAN_LICENSE } from '@/lib/deployment-mode';
import { refreshLicenseRevocationCache } from '@/lib/license-revocation';
import { requireLicenseWriteOk } from '@/lib/license-write-gate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  if (!CAN_LICENSE) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = await isAdminFromSession();
  if (!admin) {
    // 与 admin/layout.tsx 一致 —— 非 admin 不该感知此 API 存在
    return new NextResponse(null, { status: 404 });
  }

  // Refresh 写入 license_cache；read-only mode 下禁止大部分 admin mutate。
  // 但 grace-expired 时必须允许 refresh —— 这正是 operator 修复网络后
  // 的 remediation 路径。其他 reason（revoked / expired / malformed / missing）
  // 仍然阻断（refresh 也无济于事，需要先解决 license 本身）。
  // codex 审查 Major-4：grace-expired 排除在 gate 之外
  const writeGate = await requireLicenseWriteOk({ allowGraceExpired: true });
  if (writeGate) return writeGate;

  const result = await refreshLicenseRevocationCache({ now: new Date() });

  if (result.outcome === 'air-gapped') {
    return new NextResponse(null, {
      status: 204,
      headers: { 'Cache-Control': 'no-store' },
    });
  }

  return NextResponse.json(
    {
      outcome: result.outcome,
      version: result.version?.toString(),
      isRevoked: result.isRevoked,
      // error 字段仅在 error outcome 上存在（discriminated union）
      error: 'error' in result ? result.error : undefined,
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
