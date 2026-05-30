/**
 * GET /api/v1/telemetry/schema — public schema-discovery endpoint.
 *
 * Returns the same data structure the contract module holds in code, so
 * on-prem deployments can:
 *   - pre-flight what versions the SaaS currently accepts before the
 *     first upload of the day, and abstain (with a clear ops log) if
 *     the producer can't speak any supported version;
 *   - re-check the contract after receiving a 400
 *     unsupported-schema-version (the cron writes this into
 *     LicenseCache.lastTelemetryUpload so /admin/license surfaces it
 *     transparently).
 *
 * No auth — the contract is public information (it's also implied by
 * the response body of any 400 unsupported-schema-version). Returning
 * it via a stable endpoint avoids customers having to parse error
 * envelopes for the contract.
 *
 * SaaS-only — like the ingest endpoint. on-prem build 404s.
 */

import { NextResponse } from 'next/server';
import { IS_SAAS } from '@/lib/deployment-mode';
import {
  MAX_TELEMETRY_SCHEMA_VERSION,
  MIN_TELEMETRY_SCHEMA_VERSION,
  SUPPORTED_TELEMETRY_SCHEMA_VERSIONS,
  TELEMETRY_CONTRACT_BY_VERSION,
} from '@/lib/telemetry/schema-contract';

export const runtime = 'nodejs';
export const dynamic = 'force-static';
export const revalidate = 3600;

interface SchemaResponse {
  supportedVersions: readonly number[];
  min: number;
  max: number;
  fields: Record<number, ReadonlyArray<unknown>>;
  /** Pointer to the human-readable per-field justification doc. */
  documentationUrl: string;
}

export async function GET(): Promise<NextResponse> {
  if (!IS_SAAS) return new NextResponse(null, { status: 404 });

  const body: SchemaResponse = {
    supportedVersions: SUPPORTED_TELEMETRY_SCHEMA_VERSIONS,
    min: MIN_TELEMETRY_SCHEMA_VERSION,
    max: MAX_TELEMETRY_SCHEMA_VERSION,
    fields: Object.fromEntries(
      Object.entries(TELEMETRY_CONTRACT_BY_VERSION).map(([v, fields]) => [v, fields]),
    ),
    documentationUrl: 'https://aster-lang.dev/enterprise/telemetry-fields',
  };
  return NextResponse.json(body, {
    headers: {
      'cache-control': 'public, max-age=3600, immutable',
      'x-aster-telemetry-supported-versions': SUPPORTED_TELEMETRY_SCHEMA_VERSIONS.join(','),
    },
  });
}
