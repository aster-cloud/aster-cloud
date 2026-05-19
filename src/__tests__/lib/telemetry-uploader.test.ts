// Telemetry uploader unit tests. Focused on the wire-format contract:
//   - canonicalStringify byte-stability across object key order
//   - HMAC sign + verify round-trip uses base64url (no padding)
//   - HTTP error → typed TelemetryUploadError {transient|fatal}
//   - timeout → transient
//   - happy path returns id + deduped flag
//
// We mock fetch globally; no network in this suite.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  TelemetryUploadError,
  uploadTelemetry,
  verifyTelemetrySignature,
} from '@/lib/telemetry/uploader';
import {
  canonicalizeTelemetry,
  type TelemetryPayload,
} from '@/lib/telemetry/payload-builder';

const SAMPLE_PAYLOAD: TelemetryPayload = {
  schemaVersion: 1,
  periodStart: '2026-05-12T00:00:00.000Z',
  periodEnd: '2026-05-19T00:00:00.000Z',
  activeSeats: 7,
  policiesActive: 42,
  policyExecutionsCount: 1234,
  totalProvisionedSeats: 10,
  seatLimitHit: false,
  featuresUsed: ['ai', 'sso'],
  nodeVersion: '24.x',
};

const CFG_BASE = {
  endpoint: 'https://api.aster.test/api/v1/telemetry',
  secret: 'x'.repeat(48), // ≥ 32 enforced by cron, but uploader doesn't enforce
  secretKid: 'default',
  licenseId: 'lic_unit',
  deploymentId: 'a'.repeat(64),
  customer: 'Acme',
};

describe('canonicalizeTelemetry', () => {
  it('produces deterministic bytes regardless of object key order', () => {
    const a = canonicalizeTelemetry(SAMPLE_PAYLOAD);
    // Construct a permuted equivalent — JS doesn't guarantee insertion
    // order will be preserved through JSON round-trip, but we build
    // it deliberately so keys would come out in a different order
    // under naive JSON.stringify.
    const permuted = {
      featuresUsed: ['ai', 'sso'],
      nodeVersion: '24.x',
      schemaVersion: 1,
      totalProvisionedSeats: 10,
      activeSeats: 7,
      periodEnd: '2026-05-19T00:00:00.000Z',
      seatLimitHit: false,
      policyExecutionsCount: 1234,
      policiesActive: 42,
      periodStart: '2026-05-12T00:00:00.000Z',
    };
    const b = canonicalizeTelemetry(permuted as unknown as TelemetryPayload);
    expect(a).toBe(b);
  });

  it('omits undefined fields entirely (stable wire when optional absent)', () => {
    const withVersion = canonicalizeTelemetry({
      ...SAMPLE_PAYLOAD,
      appVersion: 'sha-abc',
    });
    const withoutVersion = canonicalizeTelemetry(SAMPLE_PAYLOAD);
    expect(withVersion).toContain('"appVersion":"sha-abc"');
    expect(withoutVersion).not.toContain('appVersion');
  });
});

describe('verifyTelemetrySignature', () => {
  it('accepts the producer\'s own signature', () => {
    const body = canonicalizeTelemetry(SAMPLE_PAYLOAD);
    const sig = createHmac('sha256', CFG_BASE.secret)
      .update(body, 'utf8')
      .digest('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(verifyTelemetrySignature(CFG_BASE.secret, body, sig)).toBe(true);
  });

  it('rejects when secret differs', () => {
    const body = canonicalizeTelemetry(SAMPLE_PAYLOAD);
    const sig = createHmac('sha256', 'other-secret')
      .update(body, 'utf8')
      .digest('base64url');
    expect(verifyTelemetrySignature(CFG_BASE.secret, body, sig)).toBe(false);
  });

  it('rejects when length mismatch (no false constant-time pass)', () => {
    expect(verifyTelemetrySignature(CFG_BASE.secret, 'x', 'short')).toBe(false);
  });
});

describe('uploadTelemetry', () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    // default to a happy 200 echo
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'srv_id_1', deduped: false }), { status: 200 }),
    ) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('sends signed POST with all required headers', async () => {
    const fetchSpy = globalThis.fetch as ReturnType<typeof vi.fn>;
    const result = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE);
    expect(result).toEqual({ id: 'srv_id_1', deduped: false });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(CFG_BASE.endpoint);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-aster-license-id']).toBe('lic_unit');
    expect(headers['x-aster-deployment-id']).toBe('a'.repeat(64));
    expect(headers['x-aster-customer']).toBe('Acme');
    expect(headers['x-aster-signature-kid']).toBe('default');
    expect(headers['x-aster-signature-alg']).toBe('HMAC-SHA256');
    expect(headers['x-aster-signature']).toMatch(/^[A-Za-z0-9_-]+$/);

    // Server-side could re-verify our signature
    const body = (init as RequestInit).body as string;
    expect(
      verifyTelemetrySignature(CFG_BASE.secret, body, headers['x-aster-signature']),
    ).toBe(true);
  });

  it('returns deduped=true when server echoes', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ id: 'srv_existing', deduped: true }), { status: 200 }),
    ) as typeof fetch;
    const result = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE);
    expect(result.deduped).toBe(true);
    expect(result.id).toBe('srv_existing');
  });

  it('translates 4xx → fatal TelemetryUploadError', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('bad signature', { status: 400 }),
    ) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE).catch((e) => e);
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('fatal');
    expect((err as TelemetryUploadError).status).toBe(400);
  });

  it('translates 5xx → transient TelemetryUploadError', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('upstream down', { status: 503 }),
    ) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE).catch((e) => e);
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('transient');
  });

  it('translates network failure → transient', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('ENOTFOUND');
    }) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE).catch((e) => e);
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('transient');
    expect((err as TelemetryUploadError).status).toBeNull();
  });

  it('aborts on timeout', async () => {
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, { ...CFG_BASE, timeoutMs: 20 }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('transient');
  });

  it('rejects malformed ingest response (no id)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    ) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE).catch((e) => e);
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('fatal');
  });

  // J4: schema-version negotiation. SaaS reply distinguishes a generic
  // 4xx (bad sig / wrong deployment) from "your schema version is no
  // longer supported, upgrade and stop retrying".
  it('translates 400 unsupported-schema-version → distinct error kind with supportedVersions', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          error: 'rejected',
          reason: 'unsupported-schema-version',
          received: 99,
          supportedVersions: [1, 2],
        }),
        {
          status: 400,
          headers: { 'x-aster-telemetry-supported-versions': '1,2' },
        },
      ),
    ) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE).catch((e) => e);
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('unsupported-schema-version');
    expect((err as TelemetryUploadError).status).toBe(400);
    expect((err as TelemetryUploadError).supportedVersions).toEqual([1, 2]);
  });

  it('falls back to header when body omits supportedVersions list', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: 'rejected', reason: 'unsupported-schema-version' }),
        {
          status: 400,
          headers: { 'x-aster-telemetry-supported-versions': '1,3' },
        },
      ),
    ) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE).catch((e) => e);
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('unsupported-schema-version');
    expect((err as TelemetryUploadError).supportedVersions).toEqual([1, 3]);
  });

  it('treats 400 with other reasons as generic fatal (not version-negotiation)', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ error: 'rejected', reason: 'signature-verify-failed' }),
        { status: 400 },
      ),
    ) as typeof fetch;
    const err = await uploadTelemetry(SAMPLE_PAYLOAD, CFG_BASE).catch((e) => e);
    expect(err).toBeInstanceOf(TelemetryUploadError);
    expect((err as TelemetryUploadError).kind).toBe('fatal');
    expect((err as TelemetryUploadError).supportedVersions).toEqual([]);
  });
});
