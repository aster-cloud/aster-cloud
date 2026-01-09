/**
 * Demo Cleanup Cron Job API
 *
 * POST /api/demo/cleanup - 清理过期的 Demo 会话数据
 * 由 Vercel Cron 每天 04:00 UTC 调用
 */

import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

// Vercel Cron 认证密钥
const CRON_SECRET = process.env.CRON_SECRET;

// POST /api/demo/cleanup - 清理过期 Demo 数据
export async function POST(req: Request) {
  try {
    // 验证 Cron 认证 - CRON_SECRET 必须设置且匹配
    const authHeader = req.headers.get('authorization');

    // 如果未配置 CRON_SECRET，拒绝所有请求
    if (!CRON_SECRET) {
      console.error('[Demo Cleanup] CRON_SECRET not configured');
      return NextResponse.json({ error: 'Service unavailable' }, { status: 503 });
    }

    if (authHeader !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // 查找所有过期的 Demo 会话
    const expiredSessions = await prisma.demoSession.findMany({
      where: {
        expiresAt: { lt: now },
      },
      select: { id: true },
    });

    const expiredIds = expiredSessions.map((s) => s.id);

    if (expiredIds.length === 0) {
      return NextResponse.json({
        message: 'No expired sessions to clean up',
        deletedCount: 0,
      });
    }

    // 级联删除过期会话（相关 policies, versions, executions, auditLogs 自动级联删除）
    const result = await prisma.demoSession.deleteMany({
      where: {
        id: { in: expiredIds },
      },
    });

    console.log(
      `[Demo Cleanup] Deleted ${result.count} expired demo sessions at ${now.toISOString()}`
    );

    return NextResponse.json({
      message: 'Cleanup completed successfully',
      deletedCount: result.count,
      timestamp: now.toISOString(),
    });
  } catch (error) {
    console.error('Error during demo cleanup:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET 方法用于健康检查
export async function GET() {
  try {
    const expiredCount = await prisma.demoSession.count({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    const totalCount = await prisma.demoSession.count();

    return NextResponse.json({
      status: 'healthy',
      totalSessions: totalCount,
      expiredSessions: expiredCount,
      nextCleanup: 'Daily at 04:00 UTC',
    });
  } catch (error) {
    console.error('Error checking demo cleanup status:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
