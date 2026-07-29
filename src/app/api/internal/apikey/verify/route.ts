/**
 * 内部接口：API key 验证（HMAC 签名）
 *
 * POST { keyHash: "<sha256-hex>" } → {
 *   valid, userId?, tenantId?, apiKeyId?, plan?, revokedAt?, expiredAt?
 * }
 *
 * 由 aster-api ApiKeyVerifierService 调用（5min Caffeine 缓存）。
 * 单条 SQL JOIN，期望响应 < 10ms。
 */
import { NextResponse } from 'next/server';
import { db, apiKeys, users } from '@/lib/prisma';
import { verifyInternalSignature } from '@/lib/api-signing';
import { eq } from 'drizzle-orm';
import { SOLO_TENANT_ROLE } from '@/lib/team-permissions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // HMAC 验签（与 plan-gate 同一套密钥）
  const sharedKey = process.env.ASTER_PLAN_GATE_HMAC_KEY;
  // Fail-closed: without the shared HMAC key we cannot authenticate the
  // caller, so refuse to serve rather than leak data (audit #168).
  if (!sharedKey) {
    return NextResponse.json({ error: 'Internal verification unavailable' }, { status: 503 });
  }
  // ★body 必须先以文本读出：v2 canonical 绑定 bodyHash，而 Request body 只能读一次。
  // 先 text() 再 JSON.parse，顺序不可颠倒。
  const rawBody = await req.text();

  const verified = await verifyInternalSignature(req, rawBody, sharedKey);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.reason }, { status: 401 });
  }

  let body: { keyHash?: string };
  try {
    body = JSON.parse(rawBody) as { keyHash?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (typeof body.keyHash !== 'string' || !/^[0-9a-f]{64}$/i.test(body.keyHash)) {
    return NextResponse.json({ error: 'Missing or invalid keyHash (expect 64 hex chars)' }, { status: 400 });
  }

  // 单 SQL JOIN：apiKeys + users
  const apiKey = await db.query.apiKeys.findFirst({
    where: eq(apiKeys.key, body.keyHash),
    columns: {
      id: true,
      userId: true,
      revokedAt: true,
      expiresAt: true,
    },
    with: {
      user: {
        columns: { id: true, plan: true, subscriptionStatus: true },
      },
    },
  });

  if (!apiKey) {
    return NextResponse.json({ valid: false, reason: 'not_found' });
  }
  if (apiKey.revokedAt) {
    return NextResponse.json({
      valid: false,
      reason: 'revoked',
      revokedAt: apiKey.revokedAt.toISOString(),
    });
  }
  if (apiKey.expiresAt && apiKey.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({
      valid: false,
      reason: 'expired',
      expiredAt: apiKey.expiresAt.toISOString(),
    });
  }
  // user 关系可能因为 schema 不带 relations 配置而拿不到；用 fallback 查一次
  const user = apiKey.user
    ?? (await db.query.users.findFirst({
      where: eq(users.id, apiKey.userId),
      columns: { id: true, plan: true, subscriptionStatus: true },
    }));
  if (!user) {
    return NextResponse.json({ valid: false, reason: 'orphan_key' });
  }

  return NextResponse.json({
    valid: true,
    apiKeyId: apiKey.id,
    userId: user.id,
    tenantId: user.id, // 当前 tenantId 与 userId 同源（与 plan-gate 一致）
    plan: user.plan,
    subscriptionStatus: user.subscriptionStatus ?? null,
    // RBAC 角色（与 aster-api Role / 本仓 teamRoleEnum 对齐：owner/admin/member/viewer）。
    // 当前数据模型 tenantId === userId：API key 持有者就是其单用户租户的所有者，
    // 因此对**自己的**资源（含审计/分析）拥有 owner 权限。aster-api 用该角色
    // 无条件覆盖 X-User-Role，杜绝持普通 key 自带 ADMIN 头提权（owner ≥ admin，
    // 满足审计端点文档约定的 ADMIN 要求）。引入真正的多租户 team 后，这里改为
    // 查 teamMembers.role(teamId=租户, userId) 即可，aster-api 侧无需改动。
    role: SOLO_TENANT_ROLE,
  });
}
