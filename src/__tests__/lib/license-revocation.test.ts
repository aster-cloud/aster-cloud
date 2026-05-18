// License revocation 测试：
//   - fetchRevocationDoc：所有 outcome 路径（含 timeout、非 https、版本回滚、过期 doc）
//   - evaluateGracePeriod：5 状态 + 边界条件（25h、7d 临界）
//   - isLicenseRevoked：licenseId + isRevoked 双重匹配
//
// 不测 DB 层（upsertCache / loadCurrentCache）— 那需要真实 Postgres，留给 PR-L11 集成测试

import { describe, expect, it, vi } from 'vitest';
import {
  canonicalizeRevocationDoc,
  evaluateGracePeriod,
  fetchRevocationDoc,
  isLicenseRevoked,
  type RevocationCacheRow,
  type SignedRevocationDoc,
} from '@/lib/license-revocation';
import type { TrustBundleEntry } from '@/lib/license-trust-bundle';

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Buffer.from(digest).toString('hex');
}

/** 用一次性 Ed25519 keypair 签出测试 revocation doc。 */
async function signedDoc(
  overrides: Partial<SignedRevocationDoc> = {},
): Promise<{
  doc: SignedRevocationDoc;
  bundle: readonly TrustBundleEntry[];
}> {
  const keyPair = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey('raw', keyPair.publicKey),
  );
  const unsigned = {
    schemaVersion: 1 as const,
    version: 2,
    publishedAt: '2026-06-15T00:00:00.000Z',
    validUntil: '2026-06-22T00:00:00.000Z',
    revoked: [
      {
        licenseId: 'lic_revoked',
        revokedAt: '2026-06-14T00:00:00.000Z',
        reason: 'security' as const,
      },
    ],
    ...overrides,
  };
  const placeholder: SignedRevocationDoc = { ...unsigned, signature: '' };
  const messageBytes = canonicalizeRevocationDoc(placeholder);
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      'Ed25519',
      keyPair.privateKey,
      messageBytes.slice().buffer,
    ),
  );
  const doc: SignedRevocationDoc = { ...unsigned, signature: b64url(sig) };
  return {
    doc,
    bundle: [
      {
        keyId: 'test-rev-2026-01',
        purpose: 'revocation',
        pubKey: Buffer.from(publicKeyBytes).toString('base64'),
        status: 'active',
        activatedAt: '2026-01-01T00:00:00.000Z',
        fingerprint: await sha256Hex(publicKeyBytes),
      },
    ],
  };
}

function response(body: unknown, init: ResponseInit = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status: 200,
    headers: { etag: '"v2"' },
    ...init,
  });
}

describe('evaluateGracePeriod', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');
  const stalenessWindowMs = 25 * 60 * 60 * 1000;
  const graceWindowMs = 7 * 24 * 60 * 60 * 1000;

  it('null cache → not-applicable', () => {
    expect(evaluateGracePeriod(null, now)).toBe('not-applicable');
  });

  it('cache 存在但从未 fetch 也未 success → not-applicable', () => {
    expect(
      evaluateGracePeriod({ licenseId: 'lic', isRevoked: false }, now),
    ).toBe('not-applicable');
  });

  it('有 fetch 记录但从未 success → error（无 grace 基线）', () => {
    expect(
      evaluateGracePeriod(
        {
          licenseId: 'lic',
          isRevoked: false,
          revocationFetchedAt: new Date('2026-06-15T00:00:00.000Z'),
        },
        now,
      ),
    ).toBe('error');
  });

  it.each([
    ['fresh - 刚好在 25h 内', stalenessWindowMs - 1, 'fresh'],
    ['fresh - 25h 边界（包含）', stalenessWindowMs, 'fresh'],
    ['grace - 25h+1ms', stalenessWindowMs + 1, 'grace'],
    ['grace - 7d 边界（包含）', graceWindowMs, 'grace'],
    ['grace-expired - 7d+1ms', graceWindowMs + 1, 'grace-expired'],
  ] as const)('%s', (_name, ageMs, expected) => {
    const cache: RevocationCacheRow = {
      licenseId: 'lic',
      isRevoked: false,
      revocationFetchedAt: now,
      lastSuccessfulRevocationCheckAt: new Date(now.getTime() - ageMs),
    };
    expect(evaluateGracePeriod(cache, now)).toBe(expected);
  });

  it('自定义 graceWindowMs 覆盖默认值', () => {
    const cache: RevocationCacheRow = {
      licenseId: 'lic',
      isRevoked: false,
      revocationFetchedAt: now,
      lastSuccessfulRevocationCheckAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
    };
    // 3 天前 + 默认 7 天 grace → grace；自定义 1 天 → grace-expired
    expect(evaluateGracePeriod(cache, now)).toBe('grace');
    expect(
      evaluateGracePeriod(cache, now, {
        graceWindowMs: 1 * 24 * 60 * 60 * 1000,
      }),
    ).toBe('grace-expired');
  });
});

describe('isLicenseRevoked', () => {
  it('licenseId 与 cache 匹配且 isRevoked=true → true', () => {
    expect(
      isLicenseRevoked({ licenseId: 'lic_1', isRevoked: true }, 'lic_1'),
    ).toBe(true);
  });

  it('licenseId 不匹配 → false', () => {
    expect(
      isLicenseRevoked({ licenseId: 'lic_1', isRevoked: true }, 'lic_2'),
    ).toBe(false);
  });

  it('isRevoked=false → false', () => {
    expect(
      isLicenseRevoked({ licenseId: 'lic_1', isRevoked: false }, 'lic_1'),
    ).toBe(false);
  });

  it('cache null → false', () => {
    expect(isLicenseRevoked(null, 'lic_1')).toBe(false);
  });
});

describe('canonicalizeRevocationDoc', () => {
  it('忽略 signature 字段，按 key 字母序输出', async () => {
    const { doc } = await signedDoc();
    const bytes1 = canonicalizeRevocationDoc(doc);
    const reorder: SignedRevocationDoc = {
      signature: 'different-sig',
      validUntil: doc.validUntil,
      schemaVersion: doc.schemaVersion,
      version: doc.version,
      revoked: doc.revoked,
      publishedAt: doc.publishedAt,
    };
    const bytes2 = canonicalizeRevocationDoc(reorder);
    expect(new TextDecoder().decode(bytes1)).toBe(new TextDecoder().decode(bytes2));
  });
});

describe('fetchRevocationDoc', () => {
  const now = new Date('2026-06-15T12:00:00.000Z');

  it('200 OK + 有效签名 → updated', async () => {
    const { doc, bundle } = await signedDoc();
    const fetchFn = vi.fn().mockResolvedValue(response(doc));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: bundle,
      fetchFn,
    });
    expect(outcome.kind).toBe('updated');
    if (outcome.kind === 'updated') {
      expect(outcome.doc.version).toBe(2);
      expect(outcome.etag).toBe('"v2"');
    }
  });

  it('304 Not Modified（有 ETag + cachedVersion）→ not-modified', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(null, { status: 304, headers: { etag: '"v2"' } }),
    );
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      etag: '"v2"',
      cachedVersion: BigInt(2),
      fetchFn,
    });
    expect(outcome).toEqual({ kind: 'not-modified', etag: '"v2"' });
  });

  it('意外的 304（无 ETag）→ parse-error 防止中间代理伪造续期', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      new Response(null, { status: 304, headers: { etag: '"v2"' } }),
    );
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      // 既没 etag 也没 cachedVersion → 不可能合法返回 304
      fetchFn,
    });
    expect(outcome.kind).toBe('parse-error');
    if (outcome.kind === 'parse-error') {
      expect(outcome.message).toBe('unexpected-304-without-etag-or-cache');
    }
  });

  it('500 → http-error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response('oops', { status: 500 }));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      fetchFn,
    });
    expect(outcome).toMatchObject({ kind: 'http-error', status: 500 });
  });

  it('AbortController timeout → network-error', async () => {
    const fetchFn = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      fetchFn,
      timeoutMs: 1,
    });
    expect(outcome.kind).toBe('network-error');
  });

  it('malformed JSON → parse-error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(response('{not-json'));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      fetchFn,
    });
    expect(outcome.kind).toBe('parse-error');
  });

  it('合法 JSON shape 但签名错 → signature-error', async () => {
    const { doc, bundle } = await signedDoc();
    const fetchFn = vi
      .fn()
      .mockResolvedValue(response({ ...doc, signature: 'AAAA' }));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: bundle,
      fetchFn,
    });
    expect(outcome.kind).toBe('signature-error');
  });

  it('version <= cached → version-rollback', async () => {
    const { doc, bundle } = await signedDoc({ version: 2 });
    const fetchFn = vi.fn().mockResolvedValue(response(doc));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: bundle,
      cachedVersion: BigInt(2),
      fetchFn,
    });
    expect(outcome).toMatchObject({
      kind: 'version-rollback',
      cachedVersion: BigInt(2),
      receivedVersion: 2,
    });
  });

  it('非 https URL → network-error（同步拒绝）', async () => {
    const fetchFn = vi.fn();
    const outcome = await fetchRevocationDoc({
      url: 'http://license.example/revoked.json',
      now,
      fetchFn,
    });
    expect(outcome).toEqual({
      kind: 'network-error',
      message: 'revocation-url-must-be-https',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('validUntil 已过 → parse-error revocation-doc-expired', async () => {
    const { doc, bundle } = await signedDoc({
      validUntil: '2026-06-01T00:00:00.000Z',
    });
    const fetchFn = vi.fn().mockResolvedValue(response(doc));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: bundle,
      fetchFn,
    });
    expect(outcome).toEqual({
      kind: 'parse-error',
      message: 'revocation-doc-expired',
    });
  });

  it('shape 不合法（version 负数）→ parse-error shape-invalid', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      response({ schemaVersion: 1, version: -1 }),
    );
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      fetchFn,
    });
    expect(outcome).toEqual({
      kind: 'parse-error',
      message: 'revocation-doc-shape-invalid',
    });
  });

  it('服务器返回 shuffled key 顺序 → 仍能正确验签', async () => {
    const { doc, bundle } = await signedDoc();
    const shuffled = {
      signature: doc.signature,
      revoked: doc.revoked,
      validUntil: doc.validUntil,
      publishedAt: doc.publishedAt,
      version: doc.version,
      schemaVersion: doc.schemaVersion,
    };
    const fetchFn = vi.fn().mockResolvedValue(response(shuffled));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: bundle,
      fetchFn,
    });
    expect(outcome.kind).toBe('updated');
  });

  it('etag + cachedVersion 提供时发送 If-None-Match header', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      etag: '"old"',
      cachedVersion: BigInt(1),
      fetchFn,
    });
    expect(fetchFn).toHaveBeenCalledWith(
      'https://license.example/revoked.json',
      expect.objectContaining({
        headers: { 'If-None-Match': '"old"' },
      }),
    );
  });

  it('未提供 cachedVersion → 任何 version 都接受', async () => {
    const { doc, bundle } = await signedDoc({ version: 1 });
    const fetchFn = vi.fn().mockResolvedValue(response(doc));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: bundle,
      fetchFn,
    });
    expect(outcome.kind).toBe('updated');
  });

  it('retired revocation key → 不接受签名', async () => {
    const { doc, bundle } = await signedDoc();
    const retired = bundle.map((e) => ({ ...e, status: 'retired' as const }));
    const fetchFn = vi.fn().mockResolvedValue(response(doc));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: retired,
      fetchFn,
    });
    expect(outcome.kind).toBe('signature-error');
  });

  it('verify-only key → 仍接受签名（rotation 期内验旧 doc）', async () => {
    const { doc, bundle } = await signedDoc();
    const verifyOnly = bundle.map((e) => ({ ...e, status: 'verify-only' as const }));
    const fetchFn = vi.fn().mockResolvedValue(response(doc));
    const outcome = await fetchRevocationDoc({
      url: 'https://license.example/revoked.json',
      now,
      trustBundle: verifyOnly,
      fetchFn,
    });
    expect(outcome.kind).toBe('updated');
  });

  it('invalid URL → network-error invalid-url', async () => {
    const fetchFn = vi.fn();
    const outcome = await fetchRevocationDoc({
      url: 'not a url',
      now,
      fetchFn,
    });
    expect(outcome).toEqual({
      kind: 'network-error',
      message: 'invalid-url',
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
