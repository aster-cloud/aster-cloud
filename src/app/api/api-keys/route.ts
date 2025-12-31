import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createApiKey, listApiKeys } from '@/lib/api-keys';
import { hasFeatureAccess } from '@/lib/usage';

// GET /api/api-keys - List user's API keys
export async function GET() {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const keys = await listApiKeys(session.user.id);

    return NextResponse.json(keys);
  } catch (error) {
    console.error('Error listing API keys:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/api-keys - Create a new API key
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user has API access
    const hasAccess = await hasFeatureAccess(session.user.id, 'apiAccess');
    if (!hasAccess) {
      return NextResponse.json(
        {
          error: 'API access requires Pro or Team subscription',
          upgrade: true,
        },
        { status: 403 }
      );
    }

    const { name } = await req.json();

    if (!name || typeof name !== 'string') {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    const apiKey = await createApiKey(session.user.id, name);

    return NextResponse.json(apiKey, { status: 201 });
  } catch (error) {
    console.error('Error creating API key:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
