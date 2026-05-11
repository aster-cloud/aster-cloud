/**
 * AI 异常扫描 cron 路由
 *
 * 推荐每 5 分钟调用一次（Vercel/Cloudflare cron）：
 *   schedule: "*\/5 * * * *"
 *
 * 安全：CRON_SECRET 环境变量校验。
 */
import { NextRequest, NextResponse } from 'next/server';
import { detectAndBan } from '@/lib/ai-anomaly-detection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const signals = await detectAndBan();

  if (signals.length > 0) {
    console.warn(`[ai-anomaly] 自动封禁 ${signals.length} 个用户:`);
    for (const s of signals) {
      console.warn(`  - userId=${s.userId} reason="${s.reason}" until=${s.banUntil.toISOString()}`);
    }

    // TODO Slack webhook：发到 #ai-abuse 频道
    // 暂时仅 log，等 Slack token 接入后启用
  }

  return NextResponse.json({
    scanned_at: new Date().toISOString(),
    bans_issued: signals.length,
    signals: signals.map((s) => ({
      userId: s.userId,
      reason: s.reason,
      banUntil: s.banUntil.toISOString(),
    })),
  });
}
