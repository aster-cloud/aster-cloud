// CSRF check — Phase 3D-2.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkCsrf } from '@/lib/security/csrf';

const ALLOWED = ['https://aster-lang.cloud'];

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request('https://aster-lang.cloud/api/test', { method, headers });
}

const env = process.env as Record<string, string | undefined>;

describe('checkCsrf', () => {
  let savedNodeEnv: string | undefined;
  let savedAllowedOrigins: string | undefined;
  beforeEach(() => {
    savedNodeEnv = env.NODE_ENV;
    savedAllowedOrigins = env.CSRF_ALLOWED_ORIGINS;
  });
  afterEach(() => {
    env.NODE_ENV = savedNodeEnv;
    if (savedAllowedOrigins === undefined) {
      delete env.CSRF_ALLOWED_ORIGINS;
    } else {
      env.CSRF_ALLOWED_ORIGINS = savedAllowedOrigins;
    }
  });

  it('allows GET / HEAD / OPTIONS regardless of origin', () => {
    expect(checkCsrf(req('GET'), { allowedOrigins: ALLOWED }).allowed).toBe(true);
    expect(checkCsrf(req('HEAD'), { allowedOrigins: ALLOWED }).allowed).toBe(true);
    expect(checkCsrf(req('OPTIONS'), { allowedOrigins: ALLOWED }).allowed).toBe(true);
  });

  it('allows Bearer-authenticated POST regardless of origin (no cookie → no CSRF)', () => {
    const r = req('POST', { authorization: 'Bearer abc' });
    expect(checkCsrf(r, { allowedOrigins: ALLOWED }).allowed).toBe(true);
  });

  it('allows cookie-auth POST when Origin matches', () => {
    const r = req('POST', { origin: 'https://aster-lang.cloud' });
    expect(checkCsrf(r, { allowedOrigins: ALLOWED }).allowed).toBe(true);
  });

  it('rejects cookie-auth POST with mismatched Origin', () => {
    const r = req('POST', { origin: 'https://attacker.example' });
    const result = checkCsrf(r, { allowedOrigins: ALLOWED });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Origin');
  });

  it('falls back to Referer when Origin missing', () => {
    const ok = checkCsrf(req('POST', { referer: 'https://aster-lang.cloud/some/page' }), {
      allowedOrigins: ALLOWED,
    });
    expect(ok.allowed).toBe(true);

    const bad = checkCsrf(req('POST', { referer: 'https://attacker.example/x' }), {
      allowedOrigins: ALLOWED,
    });
    expect(bad.allowed).toBe(false);
  });

  it('rejects malformed Referer', () => {
    const r = req('POST', { referer: 'not-a-url' });
    const result = checkCsrf(r, { allowedOrigins: ALLOWED });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Malformed');
  });

  it('rejects state-changing requests without Origin or Referer in prod', () => {
    env.NODE_ENV = 'production';
    const r = req('POST');
    const result = checkCsrf(r, { allowedOrigins: ALLOWED });
    expect(result.allowed).toBe(false);
  });

  it('fails closed in prod when no allowed origins configured', () => {
    env.NODE_ENV = 'production';
    delete env.CSRF_ALLOWED_ORIGINS;
    delete env.NEXT_PUBLIC_APP_URL;
    const r = req('POST', { origin: 'https://anywhere.com' });
    const result = checkCsrf(r);
    expect(result.allowed).toBe(false);
  });

  it('fails open in dev with no allow-list (developer experience)', () => {
    env.NODE_ENV = 'development';
    delete env.CSRF_ALLOWED_ORIGINS;
    delete env.NEXT_PUBLIC_APP_URL;
    const r = req('POST', { origin: 'http://localhost:3000' });
    expect(checkCsrf(r).allowed).toBe(true);
  });

  it('honors CSRF_ALLOWED_ORIGINS env var', () => {
    env.CSRF_ALLOWED_ORIGINS = 'https://app.example.com,https://app2.example.com';
    const r = req('POST', { origin: 'https://app2.example.com' });
    expect(checkCsrf(r).allowed).toBe(true);
  });
});
