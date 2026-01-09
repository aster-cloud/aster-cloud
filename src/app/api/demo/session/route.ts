/**
 * Demo Session API
 *
 * POST /api/demo/session - 创建或获取 Demo 会话
 * GET /api/demo/session - 获取当前 Demo 会话状态
 */

import { NextResponse } from 'next/server';
import {
  getDemoSession,
  createDemoSession,
  formatTimeRemaining,
  getPolicyLimitInfo,
  DEMO_CONSTANTS,
} from '@/lib/demo-session';

// GET /api/demo/session - 获取当前 Demo 会话状态
export async function GET() {
  try {
    const session = await getDemoSession();

    if (!session) {
      return NextResponse.json({ session: null });
    }

    const policyLimit = await getPolicyLimitInfo(session.id);

    return NextResponse.json({
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        timeRemaining: formatTimeRemaining(session),
        createdAt: session.createdAt,
      },
      limits: {
        policies: policyLimit,
        maxPolicies: DEMO_CONSTANTS.MAX_POLICIES,
        sessionTTLHours: DEMO_CONSTANTS.SESSION_TTL_HOURS,
      },
    });
  } catch (error) {
    console.error('Error getting demo session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/demo/session - 创建新的 Demo 会话
export async function POST() {
  try {
    // 检查是否已有有效会话
    let session = await getDemoSession();

    if (!session) {
      session = await createDemoSession();
    }

    const policyLimit = await getPolicyLimitInfo(session.id);

    return NextResponse.json({
      session: {
        id: session.id,
        expiresAt: session.expiresAt,
        timeRemaining: formatTimeRemaining(session),
        createdAt: session.createdAt,
      },
      limits: {
        policies: policyLimit,
        maxPolicies: DEMO_CONSTANTS.MAX_POLICIES,
        sessionTTLHours: DEMO_CONSTANTS.SESSION_TTL_HOURS,
      },
    });
  } catch (error) {
    console.error('Error creating demo session:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
