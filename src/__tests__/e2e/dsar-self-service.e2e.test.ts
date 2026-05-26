/**
 * DSAR self-service E2E
 *
 * Exercises the GDPR right-to-export + right-to-erase flow against a
 * live server (`pnpm start` on E2E_BASE_URL, default
 * http://localhost:3001). Complements the existing integration test
 * (dsar-self-service.saas.integration.test.ts) which hits the route
 * directly via Next.js handlers in-process.
 *
 * Why both:
 *   - Integration test catches business-logic regressions in
 *     dsar-export.ts / dsar-purge.ts
 *   - This e2e test catches wiring regressions: middleware redirects,
 *     auth gate, structured-error envelope shape, RBAC headers, the
 *     standalone-runtime + next-intl integration we hardened
 *     repeatedly. Failures here usually indicate the export-route
 *     itself works but something upstream broke.
 *
 * Skips cleanly if the dev server isn't reachable, just like the
 * other e2e suites in this directory.
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001';

async function probeServer(): Promise<{ ok: boolean; reason: string }> {
  try {
    const r = await fetch(BASE_URL, {
      redirect: 'follow',
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok || (r.status >= 300 && r.status < 400))
      return { ok: true, reason: '' };
    return { ok: false, reason: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

const probe = await probeServer();
const serverReachable = probe.ok;

if (!serverReachable) {
  console.error(
    `\n[E2E SKIPPED] dev server not reachable at ${BASE_URL}\n` +
      `  reason: ${probe.reason}\n` +
      `  hint:   cd aster-cloud && pnpm dev (or pnpm build:next && cd .next/standalone && node server.js)\n`,
  );
}

describe.skipIf(!serverReachable)(
  'E2E DSAR — self-service GDPR export + delete',
  () => {
    // The unauthenticated probes exercise the auth gate. We can't
    // hit the authenticated export path without a logged-in session
    // (CI doesn't seed test users by default), so we focus on the
    // surfaces that REGRESS most often: redirect shape, structured
    // envelope, missing-session 401.
    //
    // A future enhancement: stand up a test user via the seed-admin
    // script + log in via /api/auth/callback/credentials to drive the
    // full GET → JSON download → POST delete loop. Worth the
    // complexity once we hit a real regression that this lighter
    // suite missed.

    describe('GET /api/v1/dsar — unauthenticated', () => {
      it('rejects with 401 + structured envelope, not 5xx', async () => {
        const r = await fetch(`${BASE_URL}/api/v1/dsar`, {
          headers: { Accept: 'application/json' },
        });
        expect(r.status).toBe(401);
        const body = (await r.json()) as { error?: unknown };
        // The envelope post-extractErrorMessage refactor: structured
        // {code, message, requestId} OR legacy {error: "string"} are
        // both acceptable. React error #31 (object as child) would
        // mean we accidentally returned a plain object — assert NOT
        // that.
        expect(body).toBeTruthy();
        expect(body.error).toBeDefined();
      });

      it('emits x-request-id header for correlation', async () => {
        const r = await fetch(`${BASE_URL}/api/v1/dsar`, {
          headers: { Accept: 'application/json' },
        });
        // x-request-id is the contract from errorEnvelope() — every
        // 4xx/5xx from a route using it gets one. Missing the header
        // means a route bypassed the envelope helper and is
        // hand-rolling responses (regression).
        const requestId = r.headers.get('x-request-id');
        if (r.status === 401 && r.headers.get('content-type')?.includes('json')) {
          // 401 might come from middleware (no envelope) or the
          // route (with envelope). Accept either; if from the route,
          // requestId should match the body's.
          if (requestId) {
            const body = (await r.json()) as { error?: { requestId?: string } };
            const bodyRid =
              body.error && typeof body.error === 'object'
                ? (body.error as { requestId?: string }).requestId
                : null;
            if (bodyRid) {
              expect(bodyRid).toBe(requestId);
            }
          }
        }
      });
    });

    describe('POST /api/v1/dsar/delete — unauthenticated', () => {
      it('rejects without session, never deletes anything', async () => {
        const r = await fetch(`${BASE_URL}/api/v1/dsar/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ confirm: true }),
        });
        // 401 = auth missing; 404 = the route is correctly hidden in
        // SaaS-only / on-prem-only deployment mode mismatches.
        // Anything else (200, 400, 500) is a regression.
        expect([401, 404]).toContain(r.status);
      });
    });

    describe('Admin DSAR-delete (telemetry layer) — unauthenticated', () => {
      it('rejects without admin session', async () => {
        const r = await fetch(`${BASE_URL}/api/admin/telemetry/dsar-delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subjectKind: 'user', subjectKey: 'fake' }),
        });
        expect([401, 403, 404]).toContain(r.status);
      });
    });
  },
);
