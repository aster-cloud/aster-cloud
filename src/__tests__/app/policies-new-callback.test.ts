/**
 * Regression coverage for the docs → editor deeplink callback URL.
 *
 * When an anonymous user clicks a code-block "Open in Playground"
 * link, the editor page must redirect them to /login with the full
 * original URL preserved as the callbackUrl. Without this the
 * template query is lost after sign-in and the editor renders empty.
 *
 * We test the pure URL-builder directly to avoid loading the server
 * page module (which transitively pulls in next-intl / next/navigation
 * at runtime — incompatible with the vitest mock setup).
 */

import { describe, it, expect } from 'vitest';
import { buildPoliciesNewCallback } from '@/app/[locale]/(dashboard)/policies/new/build-callback';

describe('buildPoliciesNewCallback', () => {
  it('encodes the docs template query into the callback path', () => {
    const callback = buildPoliciesNewCallback('en', {
      from: 'docs',
      template: 'policy-evaluate-basic',
    });
    expect(callback).toBe('/en/policies/new?from=docs&template=policy-evaluate-basic');
  });

  it('preserves zh locale prefix in the callback', () => {
    const callback = buildPoliciesNewCallback('zh', {
      from: 'docs',
      template: 'policy-schema',
    });
    expect(callback).toBe('/zh/policies/new?from=docs&template=policy-schema');
  });

  it('preserves de locale prefix in the callback', () => {
    const callback = buildPoliciesNewCallback('de', {
      from: 'docs',
      template: 'policy-batch',
    });
    expect(callback).toBe('/de/policies/new?from=docs&template=policy-batch');
  });

  it('uses the bare path when there are no search params', () => {
    expect(buildPoliciesNewCallback('en', {})).toBe('/en/policies/new');
  });

  it('flattens array-valued query params to the first entry', () => {
    const callback = buildPoliciesNewCallback('en', {
      template: ['policy-evaluate-basic', 'extra'],
    });
    expect(callback).toBe('/en/policies/new?template=policy-evaluate-basic');
  });

  it('ignores undefined query params', () => {
    const callback = buildPoliciesNewCallback('en', {
      from: 'docs',
      template: undefined,
    });
    expect(callback).toBe('/en/policies/new?from=docs');
  });
});
