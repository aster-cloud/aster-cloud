// Trust bundle 行为约束：
//   - findTrustedKey 必须同时匹配 keyId 与 purpose（防止 revocation key 被当作 license key）
//   - listActiveKeys 只返回 status='active' 项
//   - bundle 内 keyId 唯一（导入时 assertUniqueKeyIds 已校验）

import { describe, it, expect } from 'vitest';
import {
  ASTER_TRUST_BUNDLE,
  findTrustedKey,
  listActiveKeys,
} from '@/lib/license-trust-bundle';

describe('license trust bundle', () => {
  it('lookup by keyId + purpose returns the correct entry', () => {
    const entry = ASTER_TRUST_BUNDLE[0];
    expect(findTrustedKey(entry.keyId, entry.purpose)).toEqual(entry);
  });

  it('lookup with wrong purpose returns null', () => {
    const licenseEntry = ASTER_TRUST_BUNDLE.find((e) => e.purpose === 'license');
    expect(licenseEntry).toBeDefined();
    expect(findTrustedKey(licenseEntry!.keyId, 'revocation')).toBeNull();
  });

  it('lookup with unknown keyId returns null', () => {
    expect(findTrustedKey('nonexistent-key-id', 'license')).toBeNull();
  });

  it('listActiveKeys returns only active entries of the given purpose', () => {
    const activeLicense = listActiveKeys('license');
    expect(activeLicense.length).toBeGreaterThan(0);
    expect(activeLicense.every((e) => e.status === 'active')).toBe(true);
    expect(activeLicense.every((e) => e.purpose === 'license')).toBe(true);

    const activeRevocation = listActiveKeys('revocation');
    expect(activeRevocation.length).toBeGreaterThan(0);
    expect(activeRevocation.every((e) => e.status === 'active')).toBe(true);
    expect(activeRevocation.every((e) => e.purpose === 'revocation')).toBe(true);
  });

  it('does not contain duplicate keyIds', () => {
    const keyIds = ASTER_TRUST_BUNDLE.map((e) => e.keyId);
    expect(new Set(keyIds).size).toBe(keyIds.length);
  });

  it('every entry has a 64-char hex fingerprint (SHA-256)', () => {
    for (const entry of ASTER_TRUST_BUNDLE) {
      expect(entry.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});
