/**
 * GET /api/admin/sso — returns parsed SSO_PROVIDER config + health for
 * the on-prem admin console. SaaS mode: 404.
 */

import { NextResponse } from 'next/server';
import { isAdminFromSession } from '@/lib/admin-auth';
import { CAN_SSO } from '@/lib/deployment-mode';
import { introspectSsoConfig } from '@/lib/sso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!CAN_SSO) {
    return new NextResponse(null, { status: 404 });
  }

  const admin = await isAdminFromSession();
  if (!admin) {
    return new NextResponse(null, { status: 404 });
  }

  const introspection = introspectSsoConfig(process.env);
  return NextResponse.json(introspection, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
