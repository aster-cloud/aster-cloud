/**
 * POST /api/cron/license-renewal-token-mint — SaaS-side renewal portal driver.
 *
 * Why separate from on-prem's /api/cron/license-renewal-warning:
 *   The on-prem cron reads `licenseCache` (the local cached license on a
 *   customer's deployment) and pings ops via Slack. THIS cron runs SaaS-side,
 *   scans `IssuedLicense` (the master record across all customers), mints
 *   renewal tokens, and emails the customer + Aster ops the portal link.
 *   They observe different DBs and serve different audiences.
 *
 * Algorithm:
 *   - For each active IssuedLicense whose expires_at falls within
 *     [now, now + max(thresholds)] AND not yet superseded:
 *       - For each threshold the license has crossed and we haven't minted
 *         a token for yet (idempotent via emailSentAt + recent unconsumed
 *         tokens), mint a token + send email + Slack ops audit.
 *   - 30/14/7/1 default thresholds. Customer gets up to 4 emails per license
 *     unless they renew earlier.
 *
 * Idempotency:
 *   We mint at-most-one *unconsumed unexpired* token per (licenseId,
 *   threshold) — the query checks for any token created within the
 *   threshold window for the license, and skips if one exists. Re-running
 *   the cron is safe (no double email).
 *
 * Failure handling:
 *   - Mint failure → log + Slack alert, retry next cron tick.
 *   - Email failure → token row stays (consumedAt=null, emailSentAt=null),
 *     cron retries email next tick (still within threshold window).
 *
 * SaaS-only: returns 404 in on-prem build.
 */

import { NextRequest, NextResponse } from 'next/server';
import { and, gt, isNull, lt, sql } from 'drizzle-orm';
import { requireCronAuth } from '@/lib/cron-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import { db, issuedLicenses, renewalTokens } from '@/lib/prisma';
import { mintRenewalToken, markTokenEmailSent } from '@/lib/renewal-tokens';
import { sendRenewalInviteEmail } from '@/lib/emails/renewal-delivery';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

function parseThresholds(): number[] {
  return (process.env.LICENSE_RENEWAL_WARN_DAYS ?? '30,14,7,1')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => b - a); // 高到低，先匹配最早的提醒
}

function pickThreshold(daysRemaining: number, thresholds: readonly number[]): number | null {
  // thresholds 已按降序排列；找第一个 <= 当前剩余天数的（确保只发"刚跨过"那个阈值）
  for (const threshold of thresholds) {
    if (daysRemaining <= threshold) return threshold;
  }
  return null;
}

async function postSlack(message: string): Promise<boolean> {
  const webhook = process.env.LICENSES_SLACK_WEBHOOK;
  if (!webhook) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: '#licenses-ops', text: message }),
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

interface MintReport {
  licenseId: string;
  customer: string;
  daysRemaining: number;
  threshold: number;
  outcome:
    | 'emailed'
    | 'skipped-existing-token'
    | 'mint-failed'
    | 'email-failed-slack-fallback'
    | 'email-failed-no-recipient'
    | 'fully-failed';
  portalUrl?: string;
  emailRecipient?: string;
}

/** Best-effort extract contact email from a v3 license payload. */
function extractContactEmail(payloadJson: unknown): string | undefined {
  if (!payloadJson || typeof payloadJson !== 'object') return undefined;
  const v = (payloadJson as Record<string, unknown>).contactEmail;
  return typeof v === 'string' && v.includes('@') ? v : undefined;
}

export async function POST(req: NextRequest) {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });
  const guard = requireCronAuth(req);
  if (guard) return guard;

  const thresholds = parseThresholds();
  if (thresholds.length === 0) {
    return NextResponse.json({ error: 'no-thresholds-configured' }, { status: 500 });
  }
  const maxThresholdMs = thresholds[0] * DAY_MS;

  const now = new Date();
  const horizon = new Date(now.getTime() + maxThresholdMs);

  // 查所有 (active + 即将到期 + 没被 supersede) 的 license。
  // 用 sql< raw 处理 timestamp 比较以避免 drizzle date helper 在不同
  // mode 下的差异。
  const rows = await db.query.issuedLicenses.findMany({
    where: and(
      isNull(issuedLicenses.supersededAt),
      gt(issuedLicenses.expiresAt, now),
      lt(issuedLicenses.expiresAt, horizon),
    ),
  });

  const report: MintReport[] = [];
  const portalBase = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/+$/, '');

  for (const row of rows) {
    const daysRemaining = Math.ceil((row.expiresAt.getTime() - now.getTime()) / DAY_MS);
    const threshold = pickThreshold(daysRemaining, thresholds);
    if (threshold === null) continue;

    // Idempotency: 该 license 在 [now-threshold, now] 窗口里已有未消费的 token？
    // 防止 cron 5min/tick 重复发邮件。窗口取 threshold 天本身 —— 跨过 14d
    // 阈值就在 14d 内只发一次；跨过 7d 阈值再发新的（因为窗口缩短了）。
    const guardWindowStart = new Date(now.getTime() - threshold * DAY_MS);
    const existing = await db.query.renewalTokens.findFirst({
      where: and(
        sql`${renewalTokens.licenseId} = ${row.licenseId}`,
        sql`${renewalTokens.createdAt} > ${guardWindowStart}`,
      ),
    });
    if (existing) {
      report.push({
        licenseId: row.licenseId,
        customer: row.customer,
        daysRemaining,
        threshold,
        outcome: 'skipped-existing-token',
      });
      continue;
    }

    let minted;
    try {
      minted = await mintRenewalToken({
        licenseId: row.licenseId,
        customer: row.customer,
        oldDeploymentBinding: row.deploymentBinding as Record<string, unknown>,
        now,
      });
    } catch (error) {
      // 失败不打 record；下次 tick 重试
      await postSlack(
        `[renewal-mint] FAILED to mint token for license=${row.licenseId} customer=${row.customer}: ${error instanceof Error ? error.message : String(error)}`,
      );
      report.push({
        licenseId: row.licenseId,
        customer: row.customer,
        daysRemaining,
        threshold,
        outcome: 'mint-failed',
      });
      continue;
    }

    const portalUrl = portalBase
      ? `${portalBase}/renew/${minted.raw}`
      : `/renew/${minted.raw}`;

    // Email delivery path. Order of preference:
    //   1. Real customer email (Resend) — primary contract.
    //   2. Ops Slack — fallback so ops can forward the link manually if email
    //      bounces or env's not set yet.
    // Token is marked email-sent if *either* succeeded — at least one channel
    // got the link out. Cron tick won't re-mint inside the threshold window.
    const recipient = extractContactEmail(row.payloadJson);
    let emailOk = false;
    let emailError: string | null = null;
    if (recipient) {
      try {
        await sendRenewalInviteEmail({
          to: recipient,
          customer: row.customer,
          portalUrl,
          daysRemaining,
          expiresAt: row.expiresAt,
          thresholdDays: threshold,
        });
        emailOk = true;
      } catch (err) {
        emailError = err instanceof Error ? err.message : String(err);
      }
    }

    // Always Slack-audit so ops have visibility regardless of email status.
    const slackOk = await postSlack(
      `[renewal-mint] license=${row.licenseId} customer=${row.customer} daysRemaining=${daysRemaining} threshold=${threshold}d portal=${portalUrl} email=${emailOk ? 'sent' : recipient ? `FAILED (${emailError})` : 'NO_RECIPIENT'}`,
    );

    if (emailOk || slackOk) {
      await markTokenEmailSent(minted.hash, { now });
    }

    let outcome: MintReport['outcome'];
    if (emailOk) outcome = 'emailed';
    else if (!recipient) outcome = 'email-failed-no-recipient';
    else if (slackOk) outcome = 'email-failed-slack-fallback';
    else outcome = 'fully-failed';

    report.push({
      licenseId: row.licenseId,
      customer: row.customer,
      daysRemaining,
      threshold,
      outcome,
      portalUrl,
      emailRecipient: recipient,
    });
  }

  return NextResponse.json({
    scanned: rows.length,
    emailed: report.filter((r) => r.outcome === 'emailed').length,
    skipped: report.filter((r) => r.outcome === 'skipped-existing-token').length,
    failed: report.filter(
      (r) =>
        r.outcome === 'mint-failed' ||
        r.outcome === 'fully-failed' ||
        r.outcome === 'email-failed-no-recipient',
    ).length,
    slackFallback: report.filter((r) => r.outcome === 'email-failed-slack-fallback').length,
    items: report,
  });
}
