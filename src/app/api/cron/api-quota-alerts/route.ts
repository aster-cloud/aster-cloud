/**
 * Policy Execution API 配额预警 cron（每天 06:00 UTC）
 *
 * 扫描所有 plan ∈ {trial, pro, team} 用户的当月 API 用量百分比：
 *   ≥ 80% 发预警邮件（每月一次幂等：apiQuotaWarn80SentAt）
 *   ≥ 100% 发软警告 + 升级 CTA（apiQuotaWarn100SentAt）
 *   ≥ 200% 发停服通知（apiQuotaWarn200SentAt）
 *
 * 月初幂等标记自动失效：当 apiQuotaWarn80SentAt 月份 != 当前月，重新允许发送
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { CAN_BILLING } from '@/lib/deployment-mode';
import { db, users, apiCallRecords } from '@/lib/prisma';
import { and, eq, sql } from 'drizzle-orm';
import { getResend } from '@/lib/resend';
import { getEffectiveLimits, type PlanType } from '@/lib/plans';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface AlertResult {
  userId: string;
  email: string;
  plan: string;
  used: number;
  limit: number;
  percent: number;
  threshold: 80 | 100 | 200;
  sent: boolean;
  reason?: string;
}

export async function GET(request: NextRequest) {
  // On-prem 客户配额由 admin 控制台监控，不通过邮件提醒 —— quota email
  // 派生于 SaaS 计费模型。on-prem 客户不需要这类自动告警。
  if (!CAN_BILLING) {
    return new NextResponse(null, { status: 404 });
  }

  // R21-Critical-2: fail-closed cron auth via shared helper
  const guard = requireCronAuth(request);
  if (guard) return guard;

  const period = currentPeriod();
  const results: AlertResult[] = [];

  // 找出有 API 用量的用户（trial/pro/team）
  const candidates = await db
    .select({
      userId: apiCallRecords.userId,
      used: sql<number>`count(*)::int`,
    })
    .from(apiCallRecords)
    .where(
      and(
        eq(apiCallRecords.periodMonth, period),
        eq(apiCallRecords.status, 'success')
      )
    )
    .groupBy(apiCallRecords.userId);

  for (const c of candidates) {
    const user = await db.query.users.findFirst({
      where: eq(users.id, c.userId),
      columns: {
        email: true,
        plan: true,
        priceLockedAt: true,
        legacyTier: true,
        apiQuotaWarn80SentAt: true,
        apiQuotaWarn100SentAt: true,
        apiQuotaWarn200SentAt: true,
      },
    });
    if (!user || !user.email) continue;
    if (!['trial', 'pro', 'team'].includes(user.plan)) continue;

    const limits = getEffectiveLimits({
      plan: user.plan as PlanType,
      priceLockedAt: user.priceLockedAt,
      legacyTier: user.legacyTier,
    });
    if (limits.apiCalls === -1 || limits.apiCalls === 0) continue;

    const percent = Math.round((c.used / limits.apiCalls) * 100);
    const threshold = pickThreshold(percent);
    if (!threshold) continue;

    const lastSentField =
      threshold === 200 ? 'apiQuotaWarn200SentAt'
      : threshold === 100 ? 'apiQuotaWarn100SentAt'
      : 'apiQuotaWarn80SentAt';
    const lastSent = user[lastSentField];

    // 幂等：同一阈值同一月只发一次
    if (lastSent && sameMonth(lastSent, period)) {
      results.push({
        userId: c.userId, email: user.email, plan: user.plan,
        used: c.used, limit: limits.apiCalls, percent, threshold,
        sent: false, reason: 'already-sent-this-month',
      });
      continue;
    }

    // 发邮件
    const sent = await sendAlertEmail(user.email, user.plan, c.used, limits.apiCalls, percent, threshold);
    if (sent) {
      const updateData: Record<string, Date> = {};
      updateData[lastSentField] = new Date();
      await db.update(users).set(updateData).where(eq(users.id, c.userId));
    }
    results.push({
      userId: c.userId, email: user.email, plan: user.plan,
      used: c.used, limit: limits.apiCalls, percent, threshold, sent,
    });
  }

  return NextResponse.json({
    period,
    scanned: candidates.length,
    alerts: results,
  });
}

function pickThreshold(percent: number): 80 | 100 | 200 | null {
  if (percent >= 200) return 200;
  if (percent >= 100) return 100;
  if (percent >= 80) return 80;
  return null;
}

function currentPeriod(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sameMonth(d: Date, period: string): boolean {
  const dStr = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return dStr === period;
}

async function sendAlertEmail(
  to: string,
  plan: string,
  used: number,
  limit: number,
  percent: number,
  threshold: 80 | 100 | 200
): Promise<boolean> {
  const resend = await getResend();
  if (!resend) return false;
  const { subject, body } = buildEmail(plan, used, limit, percent, threshold);
  try {
    await resend.emails.send({
      from: `Aster Cloud <${process.env.RESEND_FROM_EMAIL || 'noreply@aster-lang.cloud'}>`,
      to,
      subject,
      text: body,
    });
    return true;
  } catch {
    return false;
  }
}

function buildEmail(plan: string, used: number, limit: number, percent: number, threshold: 80 | 100 | 200) {
  if (threshold === 200) {
    return {
      subject: '[Aster] API 配额已超 200%，调用将被限流',
      body: `您的 ${plan} 计划本月 Policy Execution API 已使用 ${used.toLocaleString()} / ${limit.toLocaleString()} 次（${percent}%）。\n\n超过 200% 上限，新调用将返回 429 错误以防止滥用。\n\n请升级套餐：https://aster-lang.cloud/pricing\n或联系 support@aster-lang.cloud 商讨企业方案。`,
    };
  }
  if (threshold === 100) {
    return {
      subject: '[Aster] API 配额已超 100%，进入软警告模式',
      body: `您的 ${plan} 计划本月 Policy Execution API 已使用 ${used.toLocaleString()} / ${limit.toLocaleString()} 次（${percent}%）。\n\n当前为软模式：调用继续放行以保 SLA，但建议尽快升级。如达到 200% 将硬限流。\n\n升级链接：https://aster-lang.cloud/pricing`,
    };
  }
  return {
    subject: '[Aster] API 配额已用 80%',
    body: `您的 ${plan} 计划本月 Policy Execution API 已使用 ${used.toLocaleString()} / ${limit.toLocaleString()} 次（${percent}%）。\n\n剩余 ${(limit - used).toLocaleString()} 次。如预计本月会超额，请提前升级以避免服务中断。\n\n升级链接：https://aster-lang.cloud/pricing`,
  };
}
