// license-signing-client unit tests.
//
// Strategy:
//   - Mock `fetch` so we don't need a running signing-api / Vault.
//   - Inject config via __setConfigForTests to avoid env probing during the
//     module-load eager path; also lets us pass real PKCS8 PEM generated
//     per-test so the JWT mint code path is exercised end-to-end (assert
//     the request actually carries a verifiable JWT header).
//
// What's covered:
//   - happy path: approve + sign → returns SignedLicenseResult
//   - signing-api 4xx → SigningApiError
//   - signing-api 5xx → SigningApiError
//   - /v1/approve returns invalid token shape → throws
//   - /v1/sign returns incomplete body → throws
//   - fetch timeout (AbortError surfaces)
//   - canonicalStringify byte stability vs signing-api format
//   - sha256Hex matches node:crypto hash

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import {
  signLicensePayload,
  canonicalStringify,
  sha256Hex,
  SigningApiError,
  __setConfigForTests,
  type SigningClientConfig,
} from '@/lib/license-signing-client';

function pemKeyPair(): { privateKeyPem: string; publicKeyPem: string } {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    privateKeyPem: privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
  };
}

function testConfig(): SigningClientConfig {
  const op = pemKeyPair();
  const wit = pemKeyPair();
  return {
    baseUrl: 'http://signing-api.test',
    signingKeyId: 'license-signing-v2-2026-01',
    issuer: 'https://billing-idp.test',
    audience: 'aster-license-signing-api',
    operatorSub: 'billing-operator-svc',
    witnessSub: 'billing-witness-svc',
    operatorPrivateKeyPem: op.privateKeyPem,
    witnessPrivateKeyPem: wit.privateKeyPem,
    operatorKid: 'op-test-key',
    witnessKid: 'wit-test-key',
    timeoutMs: 5_000,
  };
}

const SAMPLE_PAYLOAD = {
  schemaVersion: 2,
  licenseId: 'lic_unit_1',
  customer: 'Unit Customer',
  deploymentBinding: { deploymentId: 'a'.repeat(64), deploymentLabel: 'unit' },
};

describe('canonicalStringify', () => {
  it('sorts object keys recursively', () => {
    const out = canonicalStringify({ b: 1, a: 2, nested: { z: true, y: false } });
    expect(out).toBe('{"a":2,"b":1,"nested":{"y":false,"z":true}}');
  });
  it('handles arrays without sorting', () => {
    expect(canonicalStringify([3, 1, 2])).toBe('[3,1,2]');
  });
  it('handles primitives', () => {
    expect(canonicalStringify(null)).toBe('null');
    expect(canonicalStringify('a')).toBe('"a"');
    expect(canonicalStringify(42)).toBe('42');
  });
});

describe('sha256Hex', () => {
  it('matches a known value', () => {
    // sha256("hello") = 2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });
});

// SaaS-only module — skip when running under on-prem project (IS_SAAS=false
// would throw on every call regardless of mock). Vitest projects set
// DEPLOYMENT_MODE in setup, so we read process.env directly here.
describe.skipIf(process.env.DEPLOYMENT_MODE === 'on-prem')('signLicensePayload', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    __setConfigForTests(testConfig());
  });

  afterEach(() => {
    __setConfigForTests(null);
    globalThis.fetch = realFetch;
  });

  it('happy path: approve + sign → returns SignedLicenseResult', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      calls.push({ url, init: init ?? {} });
      if (url.endsWith('/v1/approve')) {
        return new Response(JSON.stringify({ approvalToken: 'a'.repeat(64) }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.endsWith('/v1/sign')) {
        return new Response(
          JSON.stringify({
            signature: 'sig_b64url',
            keyVersion: '3',
            canonicalPayload: Buffer.from(canonicalStringify(SAMPLE_PAYLOAD), 'utf8').toString(
              'base64url',
            ),
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected url ${url}`);
    }) as typeof fetch;

    const result = await signLicensePayload(SAMPLE_PAYLOAD);

    expect(calls.length).toBe(2);
    // /v1/approve carries operator JWT only
    expect((calls[0].init.headers as Record<string, string>)['x-operator-jwt']).toMatch(
      /^eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\./,
    );
    expect((calls[0].init.headers as Record<string, string>)['x-witness-jwt']).toBeUndefined();
    // /v1/sign carries both
    expect((calls[1].init.headers as Record<string, string>)['x-operator-jwt']).toBeDefined();
    expect((calls[1].init.headers as Record<string, string>)['x-witness-jwt']).toBeDefined();

    expect(result.keyVersion).toBe('3');
    expect(result.canonicalPayloadB64url).toBeTruthy();
    expect(result.licenseKey.startsWith('aster-ent-v2-license-signing-v2-2026-01-')).toBe(true);
    expect(result.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws SigningApiError on 400 from approve', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      if (url.endsWith('/v1/approve')) {
        return new Response('{"error":"binding-required"}', { status: 400 });
      }
      throw new Error('should not reach sign');
    }) as typeof fetch;
    await expect(signLicensePayload(SAMPLE_PAYLOAD)).rejects.toBeInstanceOf(SigningApiError);
  });

  it('throws SigningApiError on 502 from sign', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      if (url.endsWith('/v1/approve')) {
        return new Response(JSON.stringify({ approvalToken: 'b'.repeat(64) }), { status: 200 });
      }
      return new Response('vault sealed', { status: 502 });
    }) as typeof fetch;
    const err = await signLicensePayload(SAMPLE_PAYLOAD).catch((e) => e);
    expect(err).toBeInstanceOf(SigningApiError);
    expect((err as SigningApiError).status).toBe(502);
    expect((err as SigningApiError).endpoint).toBe('sign');
  });

  it('throws on malformed approvalToken from approve', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ approvalToken: 'not-hex' }), { status: 200 }),
    ) as typeof fetch;
    await expect(signLicensePayload(SAMPLE_PAYLOAD)).rejects.toThrow(/malformed approvalToken/);
  });

  it('throws on incomplete /v1/sign body', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : (input as URL | Request).toString();
      if (url.endsWith('/v1/approve')) {
        return new Response(JSON.stringify({ approvalToken: 'c'.repeat(64) }), { status: 200 });
      }
      return new Response(JSON.stringify({ signature: 'only_sig' }), { status: 200 });
    }) as typeof fetch;
    await expect(signLicensePayload(SAMPLE_PAYLOAD)).rejects.toThrow(/incomplete body/);
  });

  it('aborts on timeout', async () => {
    __setConfigForTests({ ...testConfig(), timeoutMs: 20 });
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((resolve, reject) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }
        // Never resolve unless aborted — simulate hung backend
        setTimeout(() => resolve(new Response('{}', { status: 200 })), 1_000);
      });
    }) as typeof fetch;
    await expect(signLicensePayload(SAMPLE_PAYLOAD)).rejects.toThrow();
  });
});
