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
  let allowed = false;
  try {
    const quota = await getLexiconQuota(session.user.id);
    allowed = quota.allowed;
  } catch (err) {
    console.error('[snapshots page] quota lookup failed', err);
  }
  if (!allowed) {
    redirect('/domain-vocabularies');
  }

  // Same fail-soft posture as the main vocab page: if the snapshot
  // table is missing or transiently unreachable, render an empty list
  // rather than 500 the whole route.
  let serialized: SerializableSnapshot[] = [];
  try {
    const snapshots = await listOwnerSnapshots(session.user.id);
    serialized = snapshots.map((s) => ({
      ...s,
      createdAt: s.createdAt.toISOString(),
    }));
  } catch (err) {
    console.error('[snapshots page] list failed', err);
  }

  return <SnapshotsContent initialSnapshots={serialized} />;
}
