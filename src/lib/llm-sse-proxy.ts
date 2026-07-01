/**
 * SSE 流式代理：浏览器 → aster-cloud Route Handler → aster-api。
 *
 * 背景：R23-Critical-2 把 aster-api 的 /api/v1/ai/* 全部加了 HMAC 鉴权。
 * /complete 已通过 src/app/api/llm/complete/route.ts 转签代理走通；
 * /generate /explain /suggest 三个 SSE 端点之前一直是浏览器直连，
 * R23 上线后就回 403。本模块是 SSE 版的等价物。
 *
 * 关键点：
 *   - SSE 必须保持 chunked transfer，绝不能 await resp.text()
 *   - 用 fetch 默认的 ReadableStream + NextResponse 直接转发 body
 *   - tenantId 从 NextAuth session 取，不信任 caller-supplied X-Tenant-Id
 *   - 上游若返回非 2xx，只透传 status + body（错误也得让前端看到）
 *
 * 已知局限：与 /complete 相同 —— 没有 activeTeamId schema，tenantId
 * 固定为 session.user.id。team 用户在 UI 切换 team 时不会切租户配额。
 */
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { signInternalCallerHeaders } from '@/lib/api-signing';

const ASTER_API_BASE =
  process.env.ASTER_POLICY_API_INTERNAL_URL ||
  process.env.NEXT_PUBLIC_ASTER_POLICY_API_URL ||
  'https://policy.aster-lang.dev';

export interface SseProxyOptions {
  /** 上游 path，例如 "/api/v1/ai/generate" */
  upstreamPath: string;
}

export async function proxyLlmSse(
  req: NextRequest,
  { upstreamPath }: SseProxyOptions
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 同 /api/llm/complete：tenantId 强行从 session 派生，不读 body 也不读 header。
  // 详见 src/app/api/llm/complete/route.ts 顶部注释里的 schema 局限说明。
  const tenantId: string = session.user.id;

  const body = await req.text();

  let signedHeaders: Awaited<ReturnType<typeof signInternalCallerHeaders>>;
  try {
    // 红队 P0-C：绑定 body + tenant 进签名。
    signedHeaders = await signInternalCallerHeaders('POST', upstreamPath, body, tenantId, '');
  } catch {
    return NextResponse.json(
      {
        error: 'cloud_misconfigured',
        message: 'ASTER_PLAN_GATE_HMAC_KEY missing on cloud server',
      },
      { status: 503 }
    );
  }

  const upstreamResp = await fetch(`${ASTER_API_BASE}${upstreamPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'X-Tenant-Id': tenantId,
      ...signedHeaders,
    },
    body,
    // Cloudflare Workers + OpenNext：fetch 默认会 stream，无需特殊 cache opt
  });

  // 上游错了就把错误透传，让前端 SSE 客户端能拿到 status code 决定下一步。
  // 注意：错误响应是 JSON / text，不是 SSE，所以走非流式路径。
  if (!upstreamResp.ok) {
    const errText = await upstreamResp.text();
    return new NextResponse(errText, {
      status: upstreamResp.status,
      headers: {
        'Content-Type':
          upstreamResp.headers.get('content-type') || 'application/json',
      },
    });
  }

  // 成功路径：直接转发 ReadableStream，保持 SSE 帧不解包。
  if (!upstreamResp.body) {
    return NextResponse.json(
      { error: 'upstream_no_body', message: 'Upstream returned 2xx but empty body' },
      { status: 502 }
    );
  }

  return new NextResponse(upstreamResp.body, {
    status: upstreamResp.status,
    headers: {
      'Content-Type':
        upstreamResp.headers.get('content-type') || 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // SSE 反向代理必备：禁止中间层缓冲（Cloudflare / Nginx）
      'X-Accel-Buffering': 'no',
    },
  });
}
