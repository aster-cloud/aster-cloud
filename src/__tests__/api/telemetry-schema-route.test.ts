// /api/v1/telemetry/schema discovery endpoint (J4).
//
// Exercises the public contract: shape, headers, on-prem 404. No DB,
// no auth — it's a pure echo of the in-code contract.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const DEPLOYMENT_MODE_ENV = process.env.DEPLOYMENT_MODE;

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (DEPLOYMENT_MODE_ENV === undefined) delete process.env.DEPLOYMENT_MODE;
  else process.env.DEPLOYMENT_MODE = DEPLOYMENT_MODE_ENV;
  vi.resetModules();
});

describe('GET /api/v1/telemetry/schema', () => {
  it('returns the contract with supportedVersions + per-version fields on SaaS', async () => {
    process.env.DEPLOYMENT_MODE = 'saas';
    const mod = await import('@/app/api/v1/telemetry/schema/route');
    const res = await mod.GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      supportedVersions: number[];
      min: number;
      max: number;
      fields: Record<string, unknown[]>;
      documentationUrl: string;
    };
    expect(body.supportedVersions).toContain(1);
    expect(body.min).toBe(1);
    expect(body.max).toBeGreaterThanOrEqual(1);
    expect(body.fields['1']).toBeInstanceOf(Array);
    expect(body.fields['1'].length).toBeGreaterThan(5);
    expect(body.documentationUrl).toMatch(/telemetry-fields/);
    expect(res.headers.get('x-aster-telemetry-supported-versions')).toBe(
      body.supportedVersions.join(','),
    );
    expect(res.headers.get('cache-control')).toMatch(/max-age=3600/);
  });

  it('returns 404 on on-prem build', async () => {
    process.env.DEPLOYMENT_MODE = 'on-prem';
    const mod = await import('@/app/api/v1/telemetry/schema/route');
    const res = await mod.GET();
    expect(res.status).toBe(404);
  });
});
