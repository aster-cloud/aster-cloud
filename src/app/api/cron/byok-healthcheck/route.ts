/**
 * BYOK 健康检查 cron
 * 每天 03:00 UTC 运行一次（与 trial reminder 时段错开）
 */
import { NextRequest, NextResponse } from 'next/server';
import { checkAllBYOKKeys } from '@/lib/ai-byok-healthcheck';
import { resend } from '@/lib/resend';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
