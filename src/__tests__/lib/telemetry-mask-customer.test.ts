// maskCustomer + ingest cross-check unit tests.
//
// The mask function is single-source-of-truth for both producer (on-prem
// cron) and consumer (SaaS ingest cross-check). Tests pin the shape so a
// careless refactor doesn't desync them.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { maskCustomer } from '@/lib/telemetry/uploader';

describe('maskCustomer', () => {
  it('produces the documented "anon-<hex12>-<len>" shape', () => {
    const out = maskCustomer('Acme Corp');
    expect(out).toMatch(/^anon-[0-9a-f]{12}-\d+$/);
  });

  it('encodes length as the original utf8 char count', () => {
    expect(maskCustomer('Acme Corp')).toMatch(/-9$/);
    expect(maskCustomer('')).toMatch(/-0$/);
    expect(maskCustomer('X'.repeat(100))).toMatch(/-100$/);
  });

  it('is deterministic — same input → same output', () => {
    expect(maskCustomer('Acme Corp')).toBe(maskCustomer('Acme Corp'));
  });

  it('differs across different inputs of same length', () => {
    expect(maskCustomer('AAAAA')).not.toBe(maskCustomer('BBBBB'));
  });

  it('uses sha256 prefix (verify against node:crypto)', () => {
    const customer = 'Acme Corp';
    const expectedHex = createHash('sha256').update(customer, 'utf8').digest('hex').slice(0, 12);
    expect(maskCustomer(customer)).toBe(`anon-${expectedHex}-${customer.length}`);
  });

  it('handles non-ascii without throwing (utf8 byte length preserved as JS char count)', () => {
    expect(maskCustomer('阿斯特')).toMatch(/^anon-[0-9a-f]{12}-3$/);
    expect(maskCustomer('日本語株式会社')).toMatch(/^anon-[0-9a-f]{12}-7$/);
  });
});
