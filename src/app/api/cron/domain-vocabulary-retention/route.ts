/**
 * POST /api/cron/domain-vocabulary-retention (B13)
 *
 * Daily sweep: archives the vocabulary of users on the free plan whose
 * downgradedAt is past the 90-day retention window. Archived rows stay in
 * the DB (NOT physically deleted) so the user can restore them by
 * upgrading back; DSAR-driven erasure goes through the user-purge cron
 * which calls purgeUserVocabulary().
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
import { runCronOnce } from '@/lib/cron-lease';
import { parseCronWindow } from '@/lib/cron-window';
import { archiveDowngradedUserVocabulary } from '@/lib/domain-vocabulary-retention';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const guard = requireCronAuth(req);
  if (guard) return guard;

  const { acquiredBy, windowStart } = parseCronWindow(req, 'domain-vocabulary-retention');
  const outcome = await runCronOnce(
    'domain-vocabulary-retention',
    () => archiveDowngradedUserVocabulary(new Date()),
    { acquiredBy, windowStart },
  );

  if (!outcome.ran) {
    return NextResponse.json({
      ok: true,
      ran: false,
      reason: outcome.skippedReason,
      leaseId: outcome.leaseId,
    });
  }

  return NextResponse.json({
    ok: true,
    ran: true,
    leaseId: outcome.leaseId,
    ...outcome.result,
  });
}
