// License E2E 集成测试（真实 Postgres + Ed25519 签名 + canonical revocation manifest）。
//
// 启用方式：LICENSE_E2E=1 pnpm test:integration
// 不带 env 时整个 describe 通过 .skipIf 跳过，单元测试运行不受影响。
//
// 覆盖场景：
//   1. happy path：签发 v2 fixture → verifyLicenseKey → trustStatus='verified'
//   2. revoke flow：插入 revokedLicenses → publishRevocationManifest → refresh →
//      verifyLicenseKey 进入 revoked
//   3. grace-expired 软降级：人为把 lastSuccessfulRevocationCheckAt 设到 8 天前 →
//      evaluateGracePeriod=grace-expired → isLicenseReadOnlyGated 返回 gated
//   4. version-rollback 抗性：cache version=5，fetch 返回 version=3 → outcome=version-rollback
//   5. 并发 refresh 去重：5 个 parallel 调用 → 仅 1 个 updated + 4 个 concurrent-refresh

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  db,
  licenseCache,
  revokedLicenses,
} from '@/lib/prisma';
import { verifyLicenseKey } from '@/lib/license';
import {
  canonicalizeRevocationDoc,
  evaluateGracePeriod,
  fetchRevocationDoc,
  refreshLicenseRevocationCache,
  upsertCache,
  type SignedRevocationDoc,
} from '@/lib/license-revocation';
import { publishRevocationManifest } from '@/lib/revocation-publisher';
import {
  __resetLicenseRuntimeGateCacheForTests,
  __setTrustBundleForTests,
  isLicenseReadOnlyGated,
} from '@/lib/license-runtime-gate';
import type { TrustBundleEntry } from '@/lib/license-trust-bundle';
import {
  cleanupTestDb,
  setupTestDb,
  teardownTestDb,
} from './setup-postgres';

const enc = new TextEncoder();
const DAY_MS = 24 * 60 * 60 * 1000;

interface Keys {
  licensePrivateKey: CryptoKey;
  revocationPrivateKey: CryptoKey;
  trustBundle: readonly TrustBundleEntry[];
}

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Buffer.from(await crypto.subtle.digest('SHA-256', toArrayBuffer(bytes))).toString(
    'hex',
  );
}

// 拷贝到独立 ArrayBuffer 满足 Web Crypto BufferSource 严格类型
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

async function createKeys(): Promise<Keys> {
  const lic = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const rev = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const licPub = new Uint8Array(await crypto.subtle.exportKey('raw', lic.publicKey));
  const revPub = new Uint8Array(await crypto.subtle.exportKey('raw', rev.publicKey));
  return {
    licensePrivateKey: lic.privateKey,
    revocationPrivateKey: rev.privateKey,
    trustBundle: [
      {
        keyId: 'lic-e2e',
        purpose: 'license',
        pubKey: b64(licPub),
        status: 'active',
        activatedAt: '2026-01-01T00:00:00.000Z',
        fingerprint: await sha256Hex(licPub),
      },
      {
        keyId: 'rev-e2e',
        purpose: 'revocation',
        pubKey: b64(revPub),
        status: 'active',
        activatedAt: '2026-01-01T00:00:00.000Z',
        fingerprint: await sha256Hex(revPub),
      },
    ],
  };
}

async function signLicense(
  keys: Keys,
  overrides: Record<string, unknown> = {},
) {
  const payload = {
    schemaVersion: 2,
    licenseId: 'lic_e2e_001',
    keyId: 'lic-e2e',
    customer: 'E2E Customer',
    issuedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    seatLimit: 100,
    tier: 'enterprise',
    features: ['ai'],
    sku: 'standard',
    licenseTerm: 'annual',
    deploymentBinding: { deploymentId: "a".repeat(64), deploymentLabel: "test-deployment" },
    revocationCheckUrl: 'https://revocation.test/revoked.json',
    ...overrides,
  };
  const payloadBytes = enc.encode(JSON.stringify(payload));
  const sig = new Uint8Array(
    await crypto.subtle.sign('Ed25519', keys.licensePrivateKey, toArrayBuffer(payloadBytes)),
  );
  return {
    payload,
    key: `aster-ent-v2-${payload.keyId}-${b64url(payloadBytes)}.${b64url(sig)}`,
  };
}

async function signDoc(
  keys: Keys,
  doc: Omit<SignedRevocationDoc, 'signature'>,
): Promise<SignedRevocationDoc> {
  const placeholder = { ...doc, signature: '' };
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'Ed25519',
      keys.revocationPrivateKey,
      toArrayBuffer(canonicalizeRevocationDoc(placeholder)),
    ),
  );
  return { ...doc, signature: b64url(sig) };
}

async function seedLicenseCache(payload: Record<string, unknown>) {
  await upsertCache({
    licenseId: String(payload.licenseId),
    licenseKeyHash: 'hash',
    payloadJson: payload,
    signingKeyId: String(payload.keyId),
    verifiedAt: new Date(),
    isRevoked: false,
  });
}

describe.skipIf(process.env.LICENSE_E2E !== '1')(
  'license E2E integration',
  () => {
    let keys: Keys;

    beforeAll(async () => {
      (process.env as Record<string, string>).NODE_ENV = 'test';
      process.env.DEPLOYMENT_MODE = 'on-prem';
      // 所有 fixture license 都用 'a'.repeat(64) 作 deploymentId；让 verify
      // 路径默认走 env 读取就能匹配，避免在每个 verifyLicenseKey 调用点都
      // 重复传 expectedDeploymentId。
      process.env.ASTER_DEPLOYMENT_ID = 'a'.repeat(64);
      await setupTestDb();
      keys = await createKeys();
      // 注入 test trust bundle 给 isLicenseReadOnlyGated（生产仅走 ASTER_TRUST_BUNDLE）
      __setTrustBundleForTests(keys.trustBundle);
    }, 120_000);

    afterAll(async () => {
      __setTrustBundleForTests(null);
      await teardownTestDb();
    });

    beforeEach(async () => {
      await cleanupTestDb();
      __resetLicenseRuntimeGateCacheForTests();
    });

    it('happy path signs and verifies v2 fixture', async () => {
      const fixture = await signLicense(keys);
      process.env.LICENSE_KEY = fixture.key;
      const result = await verifyLicenseKey(fixture.key, {
        trustBundle: keys.trustBundle,
      });
      expect(result.trustStatus).toBe('verified');
    });

    it('revoke flow publishes manifest and updates entitlement to revoked', async () => {
      const fixture = await signLicense(keys);
      process.env.LICENSE_KEY = fixture.key;
      await seedLicenseCache(fixture.payload);
      await db.insert(revokedLicenses).values({
        licenseId: fixture.payload.licenseId,
        revokedBy: 'admin_e2e',
        reason: 'security',
      });

      const published = await publishRevocationManifest({
        signFn: async (message) =>
          new Uint8Array(
            await crypto.subtle.sign(
              'Ed25519',
              keys.revocationPrivateKey,
              toArrayBuffer(message),
            ),
          ),
      });
      const row = await db.query.revocationPublications.findFirst();
      expect(row?.version).toBe(published.version);

      const refresh = await refreshLicenseRevocationCache({
        trustBundle: keys.trustBundle,
        fetchFn: vi.fn(
          async () => new Response(row!.signedDoc, { status: 200 }),
        ),
      });
      expect(refresh.outcome).toBe('updated');
      expect(refresh.isRevoked).toBe(true);

      const verify = await verifyLicenseKey(fixture.key, {
        trustBundle: keys.trustBundle,
        revocationState: {
          isRevoked: true,
          revocationVersion: published.version,
          connectivityStatus: 'fresh',
        },
      });
      expect(verify.entitlementStatus).toBe('revoked');
    });

    it('grace-expired cache gates runtime writes', async () => {
      const fixture = await signLicense(keys);
      process.env.LICENSE_KEY = fixture.key;
      await seedLicenseCache(fixture.payload);
      const stale = new Date(Date.now() - 8 * DAY_MS).toISOString();
      await db.execute(sql`
        UPDATE "LicenseCache"
        SET "last_successful_revocation_check_at" = ${stale},
            "revocation_fetched_at" = ${stale}
        WHERE "id" = 'current'
      `);
      const cache = await db.query.licenseCache.findFirst({
        where: eq(licenseCache.id, 'current'),
      });
      // findFirst 返回 row | undefined；evaluateGracePeriod 期望 RevocationCacheRow | null
      // schema row 的 payloadJson 是 unknown，需要 cast；测试不关心其内容
      const cacheRow = cache
        ? ({
            ...cache,
            payloadJson: cache.payloadJson as Record<string, unknown>,
          } as Parameters<typeof evaluateGracePeriod>[0])
        : null;
      expect(evaluateGracePeriod(cacheRow, new Date())).toBe('grace-expired');
      expect(await isLicenseReadOnlyGated()).toEqual({
        gated: true,
        reason: 'grace-expired',
      });
    });

    it('rejects version rollback', async () => {
      const fixture = await signLicense(keys);
      await seedLicenseCache(fixture.payload);
      await db.execute(
        sql`UPDATE "LicenseCache" SET "revocation_version" = 5 WHERE "id" = 'current'`,
      );
      const oldDoc = await signDoc(keys, {
        schemaVersion: 1,
        version: 3,
        publishedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 7 * DAY_MS).toISOString(),
        revoked: [],
      });
      const outcome = await fetchRevocationDoc({
        url: 'https://revocation.test/revoked.json',
        cachedVersion: BigInt(5),
        trustBundle: keys.trustBundle,
        fetchFn: vi.fn(
          async () => new Response(JSON.stringify(oldDoc), { status: 200 }),
        ),
      });
      expect(outcome.kind).toBe('version-rollback');
      const cache = await db.query.licenseCache.findFirst();
      expect(cache?.revocationVersion).toBe(BigInt(5));
    });

    it('deduplicates concurrent refresh calls via advisory lock', async () => {
      const fixture = await signLicense(keys);
      await seedLicenseCache(fixture.payload);
      const doc = await signDoc(keys, {
        schemaVersion: 1,
        version: 1,
        publishedAt: new Date().toISOString(),
        validUntil: new Date(Date.now() + 7 * DAY_MS).toISOString(),
        revoked: [],
      });
      const fetchFn = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return new Response(JSON.stringify(doc), { status: 200 });
      });
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          refreshLicenseRevocationCache({
            trustBundle: keys.trustBundle,
            fetchFn,
          }),
        ),
      );
      expect(results.filter((r) => r.outcome === 'updated')).toHaveLength(1);
      expect(
        results.filter((r) => r.outcome === 'concurrent-refresh-in-progress'),
      ).toHaveLength(4);
      expect(fetchFn).toHaveBeenCalledTimes(1);
    });
  },
);
