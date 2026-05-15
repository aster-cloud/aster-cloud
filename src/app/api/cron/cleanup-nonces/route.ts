/**
 * Nonce 清理 API 端点
 *
 * 由 Cloudflare Cron Triggers 或其他调度系统调用。
 * 使用 CRON_SECRET 环境变量进行认证。
 *
 * Cloudflare Cron 配置 (wrangler.toml):
 * [triggers]
 * crons = ["0 6 * * *"]  # 每天早上 6 点执行
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/cron-auth';
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
  // R21-Critical-2: fail-closed cron auth via shared helper
  const guard = requireCronAuth(request);
  if (guard) return guard;

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
  // R21-Critical-2: fail-closed cron auth via shared helper
  const guard = requireCronAuth(request);
  if (guard) return guard;

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
