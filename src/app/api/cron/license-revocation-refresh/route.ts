/**
 * POST /api/cron/license-revocation-refresh
 *
 * On-prem standard SKU 周期拉取签名 revocation list。
 *   - SaaS build 返回 404（路由在 SaaS 不存在）
 *   - air-gapped SKU 返回 204（无网络 revocation 行为）
 *   - 鉴权走 CRON_SECRET（requireCronAuth 在生产 fail-closed）
 *
 * 触发方式：Cloudflare Cron Trigger（wrangler.toml 配置 0 *\/6 * * *）。
 * 调用 helper：Authorization: Bearer ${CRON_SECRET}
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { CAN_LICENSE } from '@/lib/deployment-mode';
import { refreshLicenseRevocationCache } from '@/lib/license-revocation';
import { runCronOnce } from '@/lib/cron-lease';
import { parseCronWindow } from '@/lib/cron-window';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // SaaS build 不该有此路由；优先于 cron auth 检查不泄露端点存在
  if (!CAN_LICENSE) {
    return new NextResponse(null, { status: 404 });
  }

  const guard = requireCronAuth(req);
  if (guard) return guard;

  const { acquiredBy, windowStart } = parseCronWindow(req, 'license-revocation-refresh');
  const outcome = await runCronOnce(
    'license-revocation-refresh',
    () => refreshLicenseRevocationCache({ now: new Date() }),
    { acquiredBy, windowStart },
  );

  if (!outcome.ran) {
    return NextResponse.json({
      skipped: true,
      reason: outcome.skippedReason,
      windowStart: outcome.windowStart,
    });
  }

  const result = outcome.result!;
  if (result.outcome === 'air-gapped') {
    console.info(
      '[license-revocation-refresh] air-gapped license; skipping fetch',
    );
    return new NextResponse(null, { status: 204 });
  }

  return NextResponse.json({
    outcome: result.outcome,
    // bigint 不能 JSON.stringify，转 string
    version: result.version?.toString(),
    isRevoked: result.isRevoked,
    // error 字段仅在 error outcome 上存在（discriminated union）
    error: 'error' in result ? result.error : undefined,
    windowStart: outcome.windowStart,
  });
}
