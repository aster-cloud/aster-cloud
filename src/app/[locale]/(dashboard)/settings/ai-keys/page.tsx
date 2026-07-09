import { getLocale } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { db, aiKeyBindings } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import { byokTokensUsedThisMonth } from '@/lib/ai-quota';
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
      providerUrl: true,
      tokenQuota: true,
      expiresAt: true,
      lastUsedAt: true,
      lastErrorAt: true,
      lastError: true,
      createdAt: true,
    },
  });

  // 本月 BYOK 已用 tokens（每用户总量,见 ai-quota 说明）。
  const usedTokensThisMonth = await byokTokensUsedThisMonth(session.user.id);

  const initialBindings = bindings.map((b) => ({
    id: b.id,
    provider: b.provider,
    keyHint: b.keyHint,
    active: b.active,
    providerUrl: b.providerUrl ?? null,
    tokenQuota: b.tokenQuota ?? null,
    expiresAt: b.expiresAt?.toISOString() ?? null,
    usedTokensThisMonth,
    lastUsedAt: b.lastUsedAt?.toISOString() ?? null,
    lastErrorAt: b.lastErrorAt?.toISOString() ?? null,
    lastError: b.lastError ?? null,
    createdAt: b.createdAt.toISOString(),
  }));

  return <AiKeysContent initialBindings={initialBindings} locale={locale} />;
}
