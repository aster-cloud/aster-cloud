/**
 * F2.5 trial T-1 提醒 cron 路由
 *
 * 推荐每天 09:00 UTC 调用一次。Stripe 默认在 T-3 触发 webhook，
 * 我们补一封 T-1 邮件提高紧迫感，覆盖那些没在 T-3 后立即升级的用户。
 *
 * Cloudflare Cron 或 Vercel Cron 配置：crons = ["0 9 * * *"]
 *
 * 安全：CRON_SECRET 环境变量校验，避免被外部触发。
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { CAN_BILLING } from '@/lib/deployment-mode';
import { findUsersForT1Reminder, sendTrialEndingEmailForUser } from '@/lib/email/trial-ending';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // On-prem 没有 trial 概念（enterprise license 决定权限）。
  if (!CAN_BILLING) {
    return new NextResponse(null, { status: 404 });
  }

  // R21-Critical-2: fail-closed cron auth via shared helper
  const guard = requireCronAuth(request);
  if (guard) return guard;

  const candidates = await findUsersForT1Reminder();
  let sent = 0;
  let skipped = 0;

  for (const user of candidates) {
    const result = await sendTrialEndingEmailForUser(user.id, 'T-1');
    if (result.sent) {
      sent++;
    } else {
      skipped++;
    }
  }

  console.log(`[trial-day-1-reminder] candidates=${candidates.length} sent=${sent} skipped=${skipped}`);

  return NextResponse.json({
    candidates: candidates.length,
    sent,
    skipped,
  });
}
