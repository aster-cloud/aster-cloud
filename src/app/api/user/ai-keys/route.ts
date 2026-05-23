// 用户 BYOK 管理 API
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, aiKeyBindings } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { saveBYOKKey, deactivateBYOKKey } from '@/lib/ai-key-vault';
import { errorEnvelope } from '@/lib/api/error-envelope';

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
        lastUsedAt: true,
        lastErrorAt: true,
        lastError: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ bindings });
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

    const body = (await req.json()) as { provider: string; apiKey: string };
    if (!body.apiKey || body.apiKey.length < 20) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 400 });
    }
    if (!['openai', 'anthropic', 'vertex'].includes(body.provider)) {
      return NextResponse.json({ error: 'Unsupported provider' }, { status: 400 });
    }

    await saveBYOKKey({
      userId: session.user.id,
      provider: body.provider as 'openai' | 'anthropic' | 'vertex',
      apiKey: body.apiKey,
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

    await deactivateBYOKKey(session.user.id, provider);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not deactivate the AI key. Please retry; the failure has been logged.',
    });
    console.error(
      '[ai-keys DELETE] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}
