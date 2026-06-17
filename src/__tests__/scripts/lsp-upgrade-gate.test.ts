/**
 * Unit tests for the standalone LSP WebSocket upgrade gate (GitHub #98).
 *
 * Locks the security policy in lsp-server.mjs `evaluateUpgrade`:
 *   - connection cap (DoS guard)
 *   - FAIL-CLOSED origin (missing/unlisted origin rejected)
 *   - shared-secret token requirement (header or query)
 *   - fail-closed when no token configured in production
 */
import { describe, it, expect } from 'vitest';
// Importing the .mjs only pulls in the pure export; the listener bootstrap is
// guarded behind an isMain check so no socket is bound under test.
import { evaluateUpgrade } from '../../../lsp-server.mjs';

const ORIGINS = ['https://aster-lang.cloud', 'http://localhost:3000'];

function cfg(overrides: Partial<Parameters<typeof evaluateUpgrade>[1]> = {}) {
  return {
    allowedOrigins: ORIGINS,
    maxConnections: 2,
    authToken: 'sekret',
    authDisabled: false,
    isProduction: true,
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof evaluateUpgrade>[0]> = {}) {
  return {
    origin: 'https://aster-lang.cloud',
    headerToken: undefined,
    queryToken: 'sekret',
    activeCount: 0,
    ...overrides,
  };
}

describe('evaluateUpgrade — connection cap', () => {
  it('rejects (503) when at or over the cap', () => {
    expect(evaluateUpgrade(input({ activeCount: 2 }), cfg())).toEqual({
      ok: false,
      code: 503,
      reason: 'Too many connections',
    });
  });

  it('allows when under the cap', () => {
    expect(evaluateUpgrade(input({ activeCount: 1 }), cfg())).toEqual({ ok: true });
  });
});

describe('evaluateUpgrade — origin (fail closed)', () => {
  it('rejects (403) when Origin is absent', () => {
    expect(evaluateUpgrade(input({ origin: undefined }), cfg())).toMatchObject({
      ok: false,
      code: 403,
    });
  });

  it('rejects (403) when Origin is not in the allowlist', () => {
    expect(evaluateUpgrade(input({ origin: 'https://evil.example' }), cfg())).toMatchObject({
      ok: false,
      code: 403,
    });
  });

  it('allows a listed origin', () => {
    expect(evaluateUpgrade(input({ origin: 'http://localhost:3000' }), cfg())).toEqual({
      ok: true,
    });
  });
});

describe('evaluateUpgrade — token', () => {
  it('rejects (401) when token missing', () => {
    expect(
      evaluateUpgrade(input({ queryToken: undefined, headerToken: undefined }), cfg()),
    ).toMatchObject({ ok: false, code: 401 });
  });

  it('rejects (401) when token wrong', () => {
    expect(evaluateUpgrade(input({ queryToken: 'nope' }), cfg())).toMatchObject({
      ok: false,
      code: 401,
    });
  });

  it('accepts token via query param', () => {
    expect(evaluateUpgrade(input({ queryToken: 'sekret' }), cfg())).toEqual({ ok: true });
  });

  it('accepts token via x-lsp-token header', () => {
    expect(
      evaluateUpgrade(input({ queryToken: undefined, headerToken: 'sekret' }), cfg()),
    ).toEqual({ ok: true });
  });
});

describe('evaluateUpgrade — token gate not configured', () => {
  it('fails closed (401) in production when no token configured', () => {
    expect(
      evaluateUpgrade(input({ queryToken: undefined }), cfg({ authToken: '' })),
    ).toMatchObject({ ok: false, code: 401, reason: 'Token gate not configured' });
  });

  it('allows in non-production when no token configured (dev convenience)', () => {
    expect(
      evaluateUpgrade(
        input({ queryToken: undefined }),
        cfg({ authToken: '', isProduction: false }),
      ),
    ).toEqual({ ok: true });
  });

  it('allows when no token configured but auth explicitly disabled', () => {
    expect(
      evaluateUpgrade(
        input({ queryToken: undefined }),
        cfg({ authToken: '', authDisabled: true }),
      ),
    ).toEqual({ ok: true });
  });
});

describe('evaluateUpgrade — precedence', () => {
  it('cap is checked before origin', () => {
    expect(
      evaluateUpgrade(input({ activeCount: 5, origin: 'https://evil.example' }), cfg()),
    ).toMatchObject({ code: 503 });
  });

  it('origin is checked before token', () => {
    expect(
      evaluateUpgrade(input({ origin: 'https://evil.example', queryToken: undefined }), cfg()),
    ).toMatchObject({ code: 403 });
  });
});
