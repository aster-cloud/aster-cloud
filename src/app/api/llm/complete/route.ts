/**
 * R23-Critical-2 + R25-Major-2: AI complete server-side proxy.
 *
 * <p>背景：浏览器直连 aster-api `/api/v1/ai/complete` 之前是匿名调用（依赖 caller
 * 提交的 X-Tenant-Id 自报身份）。任何人都能匿名烧 LLM token / 假冒任意 tenant。
 *
 * <p>本路由是 aster-cloud server-side proxy：
 *   1. NextAuth `auth()` 校验调用者已登录
 *   2. tenantId = session.user.id（详见 in-body comment 解释为什么不走 team activeTenantId）
 *   3. signInternalCallerHeaders(method, path) 生成 X-Internal-Caller + HMAC
 *   4. 转发到 aster-api，把 ASTER_PLAN_GATE_HMAC_KEY 签名头带过去
 *
 * <p>aster-api 端 InternalCallerFilter (R23-Critical-2) 拒绝任何未签名的请求。
 *
 * <p>对应浏览器端调用从直接 fetch(`policy.aster-lang.dev/api/v1/ai/complete`) 改为
 * fetch(`/api/llm/complete`)，由 Next.js server 转发。
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { signInternalCallerHeaders } from '@/lib/api-signing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ASTER_API_BASE =
  process.env.ASTER_POLICY_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL ||
  'https://policy.aster-lang.dev';

const UPSTREAM_PATH = '/api/v1/ai/complete';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // R25-Major-2: 从 session 派生 tenantId —— caller-supplied X-Tenant-Id 不再被信任。
  //
  // 当前实现：固定使用 session.user.id。
  //
  // 已知局限（schema 限制）：aster-cloud schema 有 teams + teamMembers 但
  // **没有 users.activeTeamId 列**，因此 server 端无法知道用户当前选中了哪个
  // team。所有 AI 调用都按 user.id 归账，团队配额 / 计费需团队管理员手动协调。
  //
  // 修复路径（独立 PR）：
  //   1. db schema 加 users.activeTeamId（migration）
  //   2. 在 dashboard "switch team" UI 触发时更新 session
  //   3. 此处改成 session.user.activeTeamId ?? session.user.id
  //
  // 直到 schema 落地，"activeTenantId" 不存在；用 user.id 是诚实的回退，
  // **绝对不要**在没有 schema 支持的情况下读 `session.user.activeTenantId` ——
  // 那个字段不存在，会永远 undefined。
  const tenantId: string = session.user.id;

  const body = await req.text();

  let signedHeaders: Awaited<ReturnType<typeof signInternalCallerHeaders>>;
  try {
    // 红队 P0-C：绑定 body + tenant 进签名（防换 LLM model 烧预算 / 改租户）。
    signedHeaders = await signInternalCallerHeaders('POST', UPSTREAM_PATH, body, tenantId, '');
  } catch {
    // ASTER_PLAN_GATE_HMAC_KEY 未配置 —— 生产应当配齐
    return NextResponse.json(
      {
        error: 'cloud_misconfigured',
        message: 'ASTER_PLAN_GATE_HMAC_KEY missing on cloud server',
      },
      { status: 503 }
    );
  }

  const upstreamResp = await fetch(`${ASTER_API_BASE}${UPSTREAM_PATH}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Tenant-Id': tenantId,
      ...signedHeaders,
    },
    body,
  });

  const text = await upstreamResp.text();
  return new NextResponse(text, {
    status: upstreamResp.status,
    headers: {
      'Content-Type':
        upstreamResp.headers.get('content-type') || 'application/json',
    },
  });
}
