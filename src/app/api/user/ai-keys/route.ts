// 用户 BYOK 管理 API
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db, aiKeyBindings } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { saveBYOKKey, deactivateBYOKKey } from '@/lib/ai-key-vault';

export async function GET() {
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
}

export async function POST(req: Request) {
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
}

export async function DELETE(req: Request) {
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
}
