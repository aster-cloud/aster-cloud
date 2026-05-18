// GET /api/license/revoked.json (SaaS only)：
//   - on-prem → 404
//   - 无 publication → 503
//   - 有 publication → 200 + signed_doc + ETag
//   - 匹配 If-None-Match → 304
//   - Cache-Control: public, max-age=3600

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));
let isSaas = true;

vi.mock('@/lib/deployment-mode', () => ({
  get IS_SAAS() {
    return isSaas;
  },
}));

vi.mock('@/lib/prisma', async () => {
  const real = await vi.importActual<typeof import('@/db/schema')>('@/db/schema');
  return {
    ...real,
    db: {
      query: {
        revocationPublications: {
          findFirst: mocks.findFirst,
        },
      },
    },
  };
});

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/license/revoked/route');
}

beforeEach(() => {
  vi.clearAllMocks();
  isSaas = true;
});

describe('GET /api/license/revoked.json', () => {
  it('on-prem mode → 404', async () => {
    isSaas = false;
    const { GET } = await loadRoute();
    const res = await GET(new Request('https://x/api/license/revoked'));
    expect(res.status).toBe(404);
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });

  it('无 publication → 503 + error code', async () => {
    mocks.findFirst.mockResolvedValueOnce(undefined);
    const { GET } = await loadRoute();
    const res = await GET(new Request('https://x/api/license/revoked'));
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: 'no-revocation-manifest-published-yet',
    });
  });

  it('有 publication → 200 + signed_doc body + ETag + Cache-Control', async () => {
    const signedDoc = JSON.stringify({
      schemaVersion: 1,
      version: 7,
      publishedAt: '2026-06-15T00:00:00.000Z',
      validUntil: '2026-06-22T00:00:00.000Z',
      revoked: [],
      signature: 'abc',
    });
    mocks.findFirst.mockResolvedValueOnce({
      version: BigInt(7),
      publishedAt: new Date('2026-06-15T00:00:00.000Z'),
      signedDoc,
      signature: 'abc',
      validUntil: new Date('2026-06-22T00:00:00.000Z'),
      revokedCount: 0,
    });
    const { GET } = await loadRoute();
    const res = await GET(new Request('https://x/api/license/revoked'));
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBe('"v7"');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600, must-revalidate');
    expect(await res.text()).toBe(signedDoc);
  });

  it('If-None-Match 匹配 → 304 Not Modified', async () => {
    mocks.findFirst.mockResolvedValueOnce({
      version: BigInt(7),
      publishedAt: new Date('2026-06-15T00:00:00.000Z'),
      signedDoc: '{}',
      signature: 'abc',
      validUntil: new Date('2026-06-22T00:00:00.000Z'),
      revokedCount: 0,
    });
    const { GET } = await loadRoute();
    const res = await GET(
      new Request('https://x/api/license/revoked', {
        headers: { 'If-None-Match': '"v7"' },
      }),
    );
    expect(res.status).toBe(304);
    expect(res.headers.get('ETag')).toBe('"v7"');
  });
});
