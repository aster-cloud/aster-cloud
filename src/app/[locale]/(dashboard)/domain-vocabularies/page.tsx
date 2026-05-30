import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { listUserVocabularyTerms, type TermLink } from '@/lib/domain-vocabulary';
import { getLexiconQuotaWithContext } from '@/lib/usage';
import { VocabulariesContent, type SerializableTermLink } from './vocabularies-content';

/**
 * /domain-vocabularies — server shell.
 *
 * Resolves session + plan quota + first page of the user's active links
 * and forwards them to the client. The Pro-gate banner lives in the
 * client component so it can react to plan upgrades without a full
 * round-trip; this page only chooses whether to fetch a real list or
 * fall back to an empty payload + needsUpgrade=true.
 */
export default async function DomainVocabulariesPage() {
  const session = await getSession();
  if (!session?.user?.id) {
    redirect('/login');
  }

  const userId = session.user.id;
  const ctx = await getLexiconQuotaWithContext(userId);

  let initialTerms: SerializableTermLink[] = [];
  let total = 0;
  let archivedCount = 0;

  if (ctx.allowed) {
    const result = await listUserVocabularyTerms(userId, {
      page: 1,
      pageSize: 50,
    });
    initialTerms = result.items.map(serialize);
    total = result.total;
    archivedCount = result.archivedCount;
  }

  return (
    <VocabulariesContent
      initialTerms={initialTerms}
      initialTotal={total}
      initialArchivedCount={archivedCount}
      quota={{
        maxTerms: ctx.maxTerms,
        bulkAsync: ctx.bulkAsync,
        allowed: ctx.allowed,
        plan: ctx.plan,
        downgraded: ctx.downgraded,
        trialEndsAt: ctx.trialEndsAt?.toISOString() ?? null,
      }}
    />
  );
}

function serialize(link: TermLink): SerializableTermLink {
  return {
    ...link,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}
