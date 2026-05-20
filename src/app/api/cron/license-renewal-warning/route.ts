/**
 * POST /api/cron/license-renewal-warning — on-prem license 续费提醒。
 *
 * 设计意图：
 *   - SaaS build 返回 404；on-prem 才有 license renewal 语义
 *   - 每个 license version + threshold 只通知一次（idempotent via renewal_notify_record）
 *   - Slack 3s timeout，避免 webhook 慢响应卡死整个 cron
 *   - 默认 thresholds [30,14,7,1] days（由 LICENSE_RENEWAL_WARN_DAYS 覆盖）
 */

import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { requireCronAuth } from '@/lib/cron-auth';
import { CAN_LICENSE } from '@/lib/deployment-mode';
import { db, licenseCache } from '@/lib/prisma';
import { runCronOnce } from '@/lib/cron-lease';
import { parseCronWindow } from '@/lib/cron-window';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const DAY_MS = 24 * 60 * 60 * 1000;

interface RenewalNotifyRecord {
  version?: string;
  thresholds?: Record<string, string>;
}

interface LicensePayloadLike {
  licenseId?: string;
  customer?: string;
  expiresAt?: string;
}

function parseThresholds(): number[] {
  return (process.env.LICENSE_RENEWAL_WARN_DAYS ?? '30,14,7,1')
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0)
    .sort((a, b) => a - b);
}

function pickThreshold(daysRemaining: number, thresholds: readonly number[]): number | null {
  for (const threshold of thresholds) {
    if (daysRemaining <= threshold) return threshold;
  }
  return null;
}

function normalizeRecord(value: unknown): RenewalNotifyRecord {
  if (!value || typeof value !== 'object') return { thresholds: {} };
  const o = value as Record<string, unknown>;
  const rawThresholds = o.thresholds;
  const thresholds =
    rawThresholds && typeof rawThresholds === 'object'
      ? (Object.fromEntries(
          Object.entries(rawThresholds as Record<string, unknown>).filter(
            ([, v]) => typeof v === 'string',
          ),
        ) as Record<string, string>)
      : {};
  return {
    version: typeof o.version === 'string' ? o.version : undefined,
    thresholds,
  };
}

async function postSlack(message: string): Promise<boolean> {
  const webhook = process.env.LICENSES_SLACK_WEBHOOK;
  if (!webhook) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: '#licenses-ops',
        text: message,
      }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(req: NextRequest) {
  if (!CAN_LICENSE) return new NextResponse(null, { status: 404 });

  const guard = requireCronAuth(req);
  if (guard) return guard;

  const { acquiredBy, windowStart } = parseCronWindow(req, 'license-renewal-warning');
  const outcome = await runCronOnce(
    'license-renewal-warning',
    async () => {
      const cache = await db.query.licenseCache.findFirst({
        where: eq(licenseCache.id, 'current'),
      });
      if (!cache) return { notified: false, reason: 'no-license-cache' as const };

      const payload = cache.payloadJson as LicensePayloadLike;
      if (!payload?.licenseId || !payload.expiresAt) {
        return { notified: false, reason: 'license-cache-payload-invalid' as const };
      }
      const expiresAtMs = Date.parse(payload.expiresAt);
      if (Number.isNaN(expiresAtMs)) {
        return { notified: false, reason: 'license-cache-expiry-invalid' as const };
      }
      const now = new Date();
      const daysRemaining = Math.ceil((expiresAtMs - now.getTime()) / DAY_MS);
      const threshold = pickThreshold(daysRemaining, parseThresholds());
      if (threshold === null) {
        return { notified: false, reason: 'outside-thresholds' as const, daysRemaining };
      }
      // version = signingKeyId + verifiedAtIso；license 换 key 自动重置 thresholds
      const version = `${cache.signingKeyId}:${cache.verifiedAt.toISOString()}`;
      const record = normalizeRecord(cache.renewalNotifyRecord);
      const thresholds = record.version === version ? record.thresholds ?? {} : {};
      const thresholdKey = String(threshold);
      if (thresholds[thresholdKey]) {
        return {
          notified: false,
          reason: 'already-notified' as const,
          threshold,
          daysRemaining,
        };
      }

      const sent = await postSlack(
        `License renewal warning: licenseId=${payload.licenseId}, customer=${payload.customer ?? 'unknown'}, daysRemaining=${daysRemaining}, threshold=${threshold}. Contact support@aster-lang.cloud.`,
      );

      // codex 审查 Major-2：Slack 失败时不写 record，下次 cron 会重试同 threshold；
      // 避免 webhook 一次性故障永久压制提醒。
      if (!sent) {
        return {
          notified: false,
          reason: 'slack-delivery-failed' as const,
          threshold,
          daysRemaining,
        };
      }

      const nextRecord: RenewalNotifyRecord = {
        version,
        thresholds: {
          ...thresholds,
          [thresholdKey]: now.toISOString(),
        },
      };
      await db
        .update(licenseCache)
        .set({
          renewalNotifyRecord: nextRecord,
          updatedAt: now,
        })
        .where(eq(licenseCache.id, 'current'));

      return { notified: true, threshold, daysRemaining };
    },
    { acquiredBy, windowStart },
  );

  if (!outcome.ran) {
    return NextResponse.json({
      skipped: true,
      reason: outcome.skippedReason,
      windowStart: outcome.windowStart,
    });
  }
  // Preserve the pre-V2 behavior where "no license cache" returns 204
  // (no-content) so existing alerting/cron schedulers that key on the
  // 204 signal keep working.
  if (outcome.result?.reason === 'no-license-cache') {
    return new NextResponse(null, { status: 204 });
  }
  return NextResponse.json({ ...outcome.result, windowStart: outcome.windowStart });
}
