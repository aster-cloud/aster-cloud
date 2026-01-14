/**
 * Nonce 清理 API 端点
 *
 * 由 Vercel Cron 或其他调度系统调用。
 * 使用 CRON_SECRET 环境变量进行认证。
 *
 * Vercel Cron 配置示例 (vercel.json):
 * {
 *   "crons": [
 *     {
 *       "path": "/api/cron/cleanup-nonces",
 *       "schedule": "*​/5 * * * *"
 *     }
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { cleanupNoncesJob, checkNonceHealth } from '@/cron/cleanup-nonces';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/cleanup-nonces
 *
 * 执行 Nonce 清理任务。
 * 需要 CRON_SECRET 认证。
 */
export async function GET(request: NextRequest) {
  // 验证 Cron 密钥
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  // 如果设置了 CRON_SECRET，则验证授权头
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    console.warn('[Cron] Unauthorized cleanup attempt');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await cleanupNoncesJob();

    return NextResponse.json({
      success: true,
      deletedCount: result.deletedCount,
      stats: result.stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Cleanup failed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/cron/cleanup-nonces
 *
 * 健康检查端点。
 * 检查 Nonce 表是否有过多积压。
 */
export async function POST(request: NextRequest) {
  // 验证 Cron 密钥
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 解析可选的 maxActive 参数
    let maxActive = 100000;
    try {
      const body = await request.json();
      if (typeof body.maxActive === 'number') {
        maxActive = body.maxActive;
      }
    } catch {
      // 忽略 JSON 解析错误
    }

    const health = await checkNonceHealth(maxActive);

    return NextResponse.json({
      ...health,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[Cron] Health check failed:', error);
    return NextResponse.json(
      {
        healthy: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
