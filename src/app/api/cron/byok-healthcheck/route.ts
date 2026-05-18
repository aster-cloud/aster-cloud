/**
 * BYOK 健康检查 cron
 * 每天 03:00 UTC 运行一次（与 trial reminder 时段错开）
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { CAN_BILLING } from '@/lib/deployment-mode';
import { checkAllBYOKKeys } from '@/lib/ai-byok-healthcheck';
import { getResend } from '@/lib/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // BYOK 是 SaaS Pro feature；on-prem 客户用自己的 LLM key 池由
  // license 决定，不走此 cron 路径。
  if (!CAN_BILLING) {
    return new NextResponse(null, { status: 404 });
  }

  // R21-Critical-2: fail-closed cron auth via shared helper
  const guard = requireCronAuth(request);
  if (guard) return guard;

  // 解析一次 Resend 实例供闭包复用（避免每个 BYOK key 重复 await）。
  const resend = await getResend();
  const results = await checkAllBYOKKeys(async (to, subject, body) => {
    if (!resend) return;
    await resend.emails.send({
      from: `Aster Cloud <${process.env.RESEND_FROM_EMAIL || 'noreply@aster-lang.cloud'}>`,
      to,
      subject,
      text: body,
    });
  });

  const summary = {
    healthy: results.filter((r) => r.status === 'healthy').length,
    failed: results.filter((r) => r.status === 'failed').length,
    deactivated: results.filter((r) => r.status === 'deactivated').length,
  };

  console.log(`[byok-healthcheck] ${JSON.stringify(summary)}`);
  return NextResponse.json({ scanned_at: new Date().toISOString(), summary, results });
}
