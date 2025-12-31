import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { revokeApiKey } from '@/lib/api-keys';

interface RouteParams {
  params: Promise<{ id: string }>;
}

// DELETE /api/api-keys/[id] - Revoke an API key
export async function DELETE(req: Request, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const revoked = await revokeApiKey(session.user.id, id);

    if (!revoked) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error revoking API key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
