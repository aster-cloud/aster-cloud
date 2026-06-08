import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createPolicyApiClient } from '@/services/policy/policy-api';

export async function GET() {
  const session = await getSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const client = createPolicyApiClient(session.user.id, session.user.id);
    const catalog = await client.getModuleCatalog();
    return NextResponse.json(catalog);
  } catch (error) {
    console.error('[api/aster/modules/catalog] upstream error', error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load module catalog',
      },
      { status: 502 },
    );
  }
}
