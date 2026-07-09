// 用户 BYOK 管理 API
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, aiKeyBindings } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { saveBYOKKey, deleteBYOKKey } from '@/lib/ai-key-vault';
import { errorEnvelope } from '@/lib/api/error-envelope';
import { byokTokensUsedThisMonth } from '@/lib/ai-quota';

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const bindings = await db.query.aiKeyBindings.findMany({
      where: eq(aiKeyBindings.userId, session.user.id),
      columns: {
        id: true,
        provider: true,
        keyHint: true,
        active: true,
        providerUrl: true,
        tokenQuota: true,
        expiresAt: true,
        lastUsedAt: true,
        lastErrorAt: true,
        lastError: true,
        createdAt: true,
      },
    });

    // 附本月已用 BYOK tokens（UI 显示「剩余额度」）。
    // ⚠️ aiUsageRecords 无 provider 列 → 只能给**每用户** BYOK 总量（跨所有 key 共享）,
    //    非 per-provider。tokenQuota 也据此按用户总量 enforce（见 ai-quota checkAiQuota）。
    const usedTokensThisMonth = await byokTokensUsedThisMonth(session.user.id);
    const enriched = bindings.map((b) => ({ ...b, usedTokensThisMonth }));

    return NextResponse.json({ bindings: enriched });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load AI keys. Please retry; the failure has been logged.',
    });
    console.error(
      '[ai-keys GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

export async function POST(req: Request) {
  // Wrap the BYOK write in try/catch so failures inside saveBYOKKey()
  // — pgcrypto missing, AI_KEY_ENCRYPTION_SECRET missing / too short,
  // Hyperdrive timeout, anything thrown by pgp_sym_encrypt — return a
  // structured 5xx envelope with a requestId rather than Next's
  // opaque HTML 500 page. The underlying message is logged with the
  // same requestId so on-call can correlate.
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await req.json()) as {
      provider: string;
      apiKey: string;
      providerUrl?: string | null;
      tokenQuota?: number | null;
      expiresAt?: string | null;
    };
    if (!body.apiKey || body.apiKey.length < 20) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 400 });
    }
    if (!['openai', 'anthropic', 'vertex'].includes(body.provider)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    // providerUrl：可选,非空则须是合法 https URL（防 SSRF/明文）。
    let providerUrl: string | null = null;
    if (body.providerUrl != null && body.providerUrl !== '') {
      try {
        const u = new URL(body.providerUrl);
        if (u.protocol !== 'https:') {
          return NextResponse.json({ error: 'providerUrl must be https' }, { status: 400 });
        }
        providerUrl = u.toString();
      } catch {
        return NextResponse.json({ error: 'Invalid providerUrl' }, { status: 400 });
      }
    }

    // tokenQuota：可选正整数。
    let tokenQuota: number | null = null;
    if (body.tokenQuota != null) {
      if (!Number.isInteger(body.tokenQuota) || body.tokenQuota <= 0) {
        return NextResponse.json({ error: 'tokenQuota must be a positive integer' }, { status: 400 });
      }
      tokenQuota = body.tokenQuota;
    }

    // expiresAt：可选,须是未来时间。
    let expiresAt: Date | null = null;
    if (body.expiresAt != null && body.expiresAt !== '') {
      const d = new Date(body.expiresAt);
      if (Number.isNaN(d.getTime())) {
        return NextResponse.json({ error: 'Invalid expiresAt' }, { status: 400 });
      }
      if (d.getTime() <= Date.now()) {
        return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 });
      }
      expiresAt = d;
    }

    await saveBYOKKey({
      userId: session.user.id,
      provider: body.provider as 'openai' | 'anthropic' | 'vertex',
      apiKey: body.apiKey,
      providerUrl,
      tokenQuota,
      expiresAt,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not save the AI key. Please retry; the failure has been logged.',
    });
    console.error(
      '[ai-keys POST] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const url = new URL(req.url);
    const provider = url.searchParams.get('provider');
    if (!provider) {
      return NextResponse.json({ error: 'Missing provider' }, { status: 400 });
    }

    // 撤销 = 硬删除整行（含加密 key + 历史）。用户诉求「删除该 AI Key」+ 隐私。
    await deleteBYOKKey(session.user.id, provider);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not delete the AI key. Please retry; the failure has been logged.',
    });
    console.error(
      '[ai-keys DELETE] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}
