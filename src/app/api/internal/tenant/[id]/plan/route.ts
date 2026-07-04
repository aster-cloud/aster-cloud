import { NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db, users, teams, teamMembers } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { getEffectiveLimits, type PlanType } from '@/lib/plans';

/**
 * 内部接口：返回租户当前 plan 信息
 *
 * 由 aster-api 的 PlanGateService 调用，做审批流 plan gate 等场景。
 *
 * 安全：
 *   - HMAC 签名验证（生产强制；dev 缺省共享密钥时跳过）
 *   - 仅返回最小必要字段（plan / legacyTier / approvalRequired / maxTeamMembers / evaluationsLimit）
 *
 * tenantId 解析规则（与 aster-api 调用方约定一致）：
 *   1. 先匹配 teams.id（teamId 即 tenant）
 *   2. 否则按 userId 兜底（个人账户即 tenant）
 *
 * 详见 aster-deploy/docs/pm/06-cross-service-plan-gate.md
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const tenantId = (await params).id;
  if (!tenantId) {
    return NextResponse.json({ error: 'Missing tenant id' }, { status: 400 });
  }

  // HMAC 验签：dev 可缺省 ASTER_PLAN_GATE_HMAC_KEY；生产强制
  const sharedKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  // Fail-closed: without the shared HMAC key we cannot authenticate the
  // caller, so refuse to serve rather than leak data (audit #168).
  if (!sharedKey) {
    return NextResponse.json({ error: 'Internal verification unavailable' }, { status: 503 });
  }
  {
    const timestamp = req.headers.get('X-Aster-Timestamp');
    const signature = req.headers.get('X-Aster-Signature');
    if (!timestamp || !signature) {
      return NextResponse.json({ error: 'Missing signature headers' }, { status: 401 });
    }
    // 时间戳防重放：5 分钟窗口
    const ts = Number.parseInt(timestamp, 10);
    if (Number.isNaN(ts) || Math.abs(Date.now() / 1000 - ts) > 300) {
      return NextResponse.json({ error: 'Stale timestamp' }, { status: 401 });
    }
    const url = new URL(req.url);
    const expected = createHmac('sha256', sharedKey)
      .update(`GET\n${url.pathname}\n${timestamp}`)
      .digest('hex');
    const sigBuf = Buffer.from(signature, 'utf8');
    const expBuf = Buffer.from(expected, 'utf8');
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
  }

  // 解析 tenantId：先 team，否则 user
  let user: typeof users.$inferSelect | null = null;

  const team = await db.query.teams.findFirst({ where: eq(teams.id, tenantId) });
  if (team) {
    // 用 team owner 的 plan 表示 team 档位
    const ownerMembership = await db.query.teamMembers.findFirst({
      where: eq(teamMembers.teamId, team.id),
    });
    if (ownerMembership) {
      user = await db.query.users.findFirst({ where: eq(users.id, ownerMembership.userId) }) ?? null;
    }
  }

  if (!user) {
    user = await db.query.users.findFirst({ where: eq(users.id, tenantId) }) ?? null;
  }

  if (!user) {
    // 找不到的 tenant 按 free 处理；plan-gate fail-open=true 时业务侧继续
    return NextResponse.json({
      plan: 'free',
      legacyTier: null,
      allowsApproval: false,
      maxTeamMembers: 1,
      evaluationsLimit: 1000,
      apiCallsLimit: 0,
    });
  }

  const limits = getEffectiveLimits({
    plan: user.plan as PlanType,
    priceLockedAt: user.priceLockedAt,
    legacyTier: user.legacyTier,
  });

  return NextResponse.json({
    plan: user.plan,
    legacyTier: user.legacyTier ?? null,
    allowsApproval: limits.approvalRequired,
    maxTeamMembers: limits.maxTeamMembers,
    evaluationsLimit: limits.evaluations,
    apiCallsLimit: limits.apiCalls,
  });
}
