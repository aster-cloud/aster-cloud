import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { db, aiKeyBindings } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { AiKeysContent } from './ai-keys-content';

export default async function AiKeysPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const locale = await getLocale();

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

  const initialBindings = bindings.map((b) => ({
    id: b.id,
    provider: b.provider,
    keyHint: b.keyHint,
    active: b.active,
    lastUsedAt: b.lastUsedAt?.toISOString() ?? null,
    lastErrorAt: b.lastErrorAt?.toISOString() ?? null,
    lastError: b.lastError ?? null,
    createdAt: b.createdAt.toISOString(),
  }));

  return <AiKeysContent initialBindings={initialBindings} locale={locale} />;
}
