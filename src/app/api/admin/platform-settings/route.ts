/*
 * Admin platform-settings API.
 *
 * GET  /api/admin/platform-settings        → current values for every known key
 * POST /api/admin/platform-settings        → { key, value } upsert (admin-only)
 *
 * Permission: isAdmin only (requireAdmin from lib/admin-auth). The
 * route handles every defined key in PLATFORM_SETTING_KEYS — adding
 * a new flag means adding the key constant + default, not a new
 * endpoint.
 */

import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { requireLicenseWriteOk } from '@/lib/license-write-gate';
import {
  PLATFORM_SETTING_KEYS,
  getSetting,
  setSetting,
} from '@/lib/platform-settings';
import { errorEnvelope } from '@/lib/api/error-envelope';

export async function GET() {
  try {
    const check = await requireAdmin();
    if (check instanceof NextResponse) return check;

    // Read every known key in parallel. Missing rows fall back to
    // the per-key default (see DEFAULTS in platform-settings.ts).
    const entries = await Promise.all(
      Object.entries(PLATFORM_SETTING_KEYS).map(async ([label, key]) => {
        const value = await getSetting(key);
        return [label, { key, value }] as const;
      }),
    );
    return NextResponse.json({ settings: Object.fromEntries(entries) });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not load platform settings.',
    });
    console.error(
      '[platform-settings GET] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}

export async function POST(req: Request) {
  // License gate runs top-level (lint rule) so a grace-expired /
  // revoked on-prem license can't flip platform flags. SaaS is
  // always a no-op here.
  const writeGate = await requireLicenseWriteOk();
  if (writeGate) return writeGate;

  try {
    const check = await requireAdmin();
    if (check instanceof NextResponse) return check;

    const body = (await req.json()) as { key?: string; value?: unknown };
    if (!body.key || typeof body.key !== 'string') {
      return NextResponse.json({ error: 'key is required' }, { status: 400 });
    }
    // Whitelist: only let admins toggle keys we explicitly know about.
    const known = Object.values(PLATFORM_SETTING_KEYS) as string[];
    if (!known.includes(body.key)) {
      return NextResponse.json(
        { error: `Unknown setting key: ${body.key}` },
        { status: 400 },
      );
    }
    await setSetting(body.key, body.value, check.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const env = errorEnvelope({
      status: 500,
      code: 'service_unavailable',
      message: 'Could not update platform setting.',
    });
    console.error(
      '[platform-settings POST] handler failed',
      env.headers.get('x-request-id'),
      err,
    );
    return env;
  }
}
