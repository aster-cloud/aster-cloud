/**
 * 回放明文授权开关：GET / PATCH /api/user/replay-retention
 *
 * <p>读写当前用户的 {@code User.replayRetentionEnabled}。
 *
 * <p><b>这个开关授权什么</b>：允许平台把**已存在的**历史执行明文输入
 * 用于重跑分析（What-if / 回归工具）。
 *
 * <p>★它**不是**存储开关——`Execution.input` 是无条件写入的（见两条 execute
 * 路径）。第八/九轮交叉审查指出过一版把它描述成「未开启就不保存明文」的
 * 错误文案，那是不实的。这里的语义是**使用授权**。
 *
 * <p><b>为什么需要这个端点</b>：该字段默认 false 且此前**没有任何写入口**
 * （UI/API 皆无），等于依赖它的能力永远无法自助开启（第九轮 P0-8）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, users } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { errorEnvelope } from '@/lib/api/error-envelope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({ code: 'UNAUTHORIZED', message: '未登录', status: 401 });
  }
  const [row] = await db
    .select({ enabled: users.replayRetentionEnabled })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  // 查不到用户行按未授权处理（fail-closed）——不猜测默认值
  return NextResponse.json({ enabled: row?.enabled === true });
}

export async function PATCH(request: NextRequest): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({ code: 'UNAUTHORIZED', message: '未登录', status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorEnvelope({ code: 'INVALID_JSON', message: '请求体不是合法 JSON', status: 400 });
  }
  const enabled = (body as { enabled?: unknown } | null)?.enabled;
  // ★必须是真布尔：`"false"` / `0` 这类真值语义含糊的输入一律拒绝，
  //   授权开关上「大概是关的」这种模糊性不可接受。
  if (typeof enabled !== 'boolean') {
    return errorEnvelope({
      code: 'INVALID_PARAM',
      message: 'enabled 必须是布尔值',
      status: 400,
    });
  }

  // ★只改自己那一行——不带 userId 的 update 会改全表
  const written = await db
    .update(users)
    .set({ replayRetentionEnabled: enabled })
    .where(eq(users.id, session.user.id))
    .returning({ enabled: users.replayRetentionEnabled });

  // ★零行更新必须报错而不是假装成功（第十一轮 item 7）：
  //   用户行不存在时静默返回 200 会让前端显示「已开启」，实际什么都没写。
  if (written.length === 0) {
    return errorEnvelope({
      code: 'NOT_FOUND',
      message: '用户不存在，设置未写入',
      status: 404,
    });
  }

  // 回读真实落库值，不回显请求值
  return NextResponse.json({ enabled: written[0].enabled });
}
