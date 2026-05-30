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

  // ensureSchemaApplied() in the dashboard layout self-heals the vocab
  // tables on cold start, but if that single bootstrap call lost a race
  // or the Worker isolate skipped it (e.g. the layout's promise was
  // already resolved but pointing at a partial schema), the service
  // queries below would 42P01. Treat any service failure as "no vocab
  // yet" so the page renders the empty/Pro-gate state instead of a
  // production 500.
  let ctx: Awaited<ReturnType<typeof getLexiconQuotaWithContext>>;
  try {
    ctx = await getLexiconQuotaWithContext(userId);
  } catch (err) {
    console.error('[domain-vocabularies page] quota lookup failed', err);
    ctx = {
      maxTerms: 0,
      bulkAsync: false,
      allowed: false,
      plan: 'free',
      downgraded: false,
      trialEndsAt: null,
    };
  }

  let initialTerms: SerializableTermLink[] = [];
  let total = 0;
  let archivedCount = 0;

  if (ctx.allowed) {
    try {
      const result = await listUserVocabularyTerms(userId, {
        page: 1,
        pageSize: 50,
      });
      initialTerms = result.items.map(serialize);
      total = result.total;
      archivedCount = result.archivedCount;
    } catch (err) {
      console.error('[domain-vocabularies page] list failed', err);
      // Fall through with empty list; the client will show the empty
      // state with the breadcrumb + Add-term affordance intact.
    }
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
