/**
 * 催收邮件 cron（每天 06:30 UTC）
 *
 * 扫描所有 subscriptionStatus=past_due 的用户，按 grace period 阶段发对应邮件。
 * 幂等通过 dunningEmailsSentCount 控制：每发一封 +1，避免重复发送。
 */
import { NextRequest, NextResponse } from 'next/server';
import { db, users } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { resend } from '@/lib/resend';
import {
  pickDunningStage,
  shouldSendStage,
  buildDunningEmail,
  graceDaysLeft,
} from '@/lib/dunning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DunningResult {
  userId: string;
  email: string;
  stage: number | null;
  daysLeft: number;
  sent: boolean;
  reason?: string;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const candidates = await db.query.users.findMany({
    where: eq(users.subscriptionStatus, 'past_due'),
    columns: {
      id: true,
      email: true,
      name: true,
      gracePeriodStartsAt: true,
      gracePeriodEndsAt: true,
      dunningEmailsSentCount: true,
      lastDunningEmailSentAt: true,
    },
  });

  const now = new Date();
  const portalBase = `${process.env.NEXT_PUBLIC_APP_URL || 'https://aster-lang.cloud'}/billing`;
  const results: DunningResult[] = [];

  for (const u of candidates) {
    if (!u.email || !u.gracePeriodStartsAt) {
      results.push({
        userId: u.id, email: u.email ?? '',
        stage: null, daysLeft: 0,
        sent: false, reason: 'missing-email-or-grace',
      });
      continue;
    }

    // 防止同一天重复发（cron 失败重跑兜底）
    if (u.lastDunningEmailSentAt && sameDay(u.lastDunningEmailSentAt, now)) {
      results.push({
        userId: u.id, email: u.email,
        stage: pickDunningStage(u.gracePeriodStartsAt, now),
        daysLeft: graceDaysLeft(u.gracePeriodEndsAt, now),
        sent: false, reason: 'already-sent-today',
      });
      continue;
    }

    const stage = pickDunningStage(u.gracePeriodStartsAt, now);
    const stageToSend = shouldSendStage(stage, u.dunningEmailsSentCount);
    if (stageToSend === null) {
      results.push({
        userId: u.id, email: u.email,
        stage, daysLeft: graceDaysLeft(u.gracePeriodEndsAt, now),
        sent: false, reason: 'no-stage-due',
      });
      continue;
    }

    const daysLeft = graceDaysLeft(u.gracePeriodEndsAt, now);
    const { subject, body } = buildDunningEmail(
      stageToSend,
      u.name || 'there',
      daysLeft,
      'unpaid invoice',
      portalBase
    );

    let sent = false;
    if (resend) {
      try {
        await resend.emails.send({
          from: `Aster Cloud <${process.env.RESEND_FROM_EMAIL || 'noreply@aster-lang.cloud'}>`,
          to: u.email,
          subject,
          text: body,
        });
        sent = true;
      } catch (err) {
        console.warn(`[dunning] send failed for ${u.email}:`, (err as Error).message);
      }
    }

    if (sent) {
      await db
        .update(users)
        .set({
          dunningEmailsSentCount: u.dunningEmailsSentCount + 1,
          lastDunningEmailSentAt: now,
        })
        .where(eq(users.id, u.id));
    }

    results.push({
      userId: u.id, email: u.email,
      stage: stageToSend, daysLeft, sent,
    });
  }

  return NextResponse.json({
    scanned: candidates.length,
    results,
  });
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
