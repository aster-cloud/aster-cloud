// CSP header builder — Phase 3D-1.
//
// Validates the structural contract; actual securityheaders.com scoring is
// a manual sanity check post-deploy.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buildCspHeader, securityHeadersOnly } from '@/lib/security/csp';

const NONCE = 'YWJjZGVmZ2hpamtsbW5vcA==';

const env = process.env as Record<string, string | undefined>;

describe('buildCspHeader', () => {
  let savedNodeEnv: string | undefined;
  beforeEach(() => {
    savedNodeEnv = env.NODE_ENV;
  });
  afterEach(() => {
    env.NODE_ENV = savedNodeEnv;
  });

  it('includes the nonce in script-src and style-src', () => {
    env.NODE_ENV = 'production';
    const csp = buildCspHeader(NONCE);
    expect(csp).toContain(`'nonce-${NONCE}'`);
    expect(csp.match(/'nonce-/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('uses strict-dynamic in script-src', () => {
    env.NODE_ENV = 'production';
    const csp = buildCspHeader(NONCE);
    expect(csp).toContain("'strict-dynamic'");
  });

  it("locks frame-ancestors to 'none' (anti-clickjacking)", () => {
    const csp = buildCspHeader(NONCE);
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("locks object-src to 'none' (blocks Flash etc.)", () => {
    const csp = buildCspHeader(NONCE);
    expect(csp).toContain("object-src 'none'");
  });

  it('allows Stripe origins for payment integration', () => {
    const csp = buildCspHeader(NONCE);
    expect(csp).toContain('https://js.stripe.com');
    expect(csp).toContain('https://api.stripe.com');
  });

  it('allows Mixpanel for analytics', () => {
    const csp = buildCspHeader(NONCE);
    expect(csp).toContain('https://api-js.mixpanel.com');
  });

  it("includes 'unsafe-eval' in dev (HMR) but not prod", () => {
    env.NODE_ENV = 'development';
    const dev = buildCspHeader(NONCE);
    expect(dev).toContain("'unsafe-eval'");

    env.NODE_ENV = 'production';
    const prod = buildCspHeader(NONCE);
    expect(prod).not.toContain("'unsafe-eval'");
  });

  it('emits upgrade-insecure-requests directive', () => {
    const csp = buildCspHeader(NONCE);
    expect(csp).toContain('upgrade-insecure-requests');
  });
});

describe('securityHeadersOnly', () => {
  const headers = securityHeadersOnly();

  it('sets HSTS with 2-year max-age + preload', () => {
    expect(headers['Strict-Transport-Security']).toContain('max-age=63072000');
    expect(headers['Strict-Transport-Security']).toContain('preload');
  });

  it('blocks MIME sniffing', () => {
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('denies framing', () => {
    expect(headers['X-Frame-Options']).toBe('DENY');
  });

  it('referrer policy is strict-origin-when-cross-origin', () => {
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
  });

  it('Permissions-Policy disables high-risk sensors', () => {
    const p = headers['Permissions-Policy'];
    expect(p).toContain('camera=()');
    expect(p).toContain('microphone=()');
    expect(p).toContain('geolocation=()');
  });

  it('opts out of FLoC', () => {
    expect(headers['Permissions-Policy']).toContain('interest-cohort=()');
  });

  it('Cross-Origin-Opener-Policy is same-origin', () => {
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
  });
});
