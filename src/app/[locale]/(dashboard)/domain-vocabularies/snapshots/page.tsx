import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { listOwnerSnapshots } from '@/lib/domain-vocabulary-snapshot';
import { getLexiconQuota } from '@/lib/usage';
import { SnapshotsContent, type SerializableSnapshot } from './snapshots-content';

/**
 * /domain-vocabularies/snapshots — server shell.
 *
 * Reads the caller's snapshots and forwards them to the client. The client
 * lazily fetches a snapshot's diff when the user opens it; we only ship
 * the lightweight list here so a user with hundreds of snapshots doesn't
 * pay for them at SSR time.
 */
export default async function SnapshotsPage() {
  const session = await getSession();
  if (!session?.user?.id) redirect('/login');
  const quota = await getLexiconQuota(session.user.id);
  if (!quota.allowed) {
    redirect('/domain-vocabularies');
  }

  const snapshots = await listOwnerSnapshots(session.user.id);
  const serialized: SerializableSnapshot[] = snapshots.map((s) => ({
    ...s,
    createdAt: s.createdAt.toISOString(),
  }));

  return <SnapshotsContent initialSnapshots={serialized} />;
}
