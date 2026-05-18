// SSO introspect 行为：
//   - SSO_PROVIDER 未设 / 为 'none' → provider=none, health=ok
//   - SSO_PROVIDER=saml + 缺 cert/metadata → incomplete + missingFields
//   - SSO_PROVIDER=saml + 有 cert → ok
//   - SSO_PROVIDER=oidc + 缺字段 → incomplete + missingFields
//   - SSO_PROVIDER=oidc + 全字段 → ok
//   - 未知 provider value → none + incomplete

import { describe, it, expect } from 'vitest';
import { introspectSsoConfig } from '@/lib/sso';

const BASE_ENV = {
  NEXT_PUBLIC_APP_URL: 'https://aster.acme.internal',
};

describe('introspectSsoConfig', () => {
  describe('none', () => {
    it('SSO_PROVIDER undefined → none + ok', () => {
      const r = introspectSsoConfig({ ...BASE_ENV });
      expect(r.config.provider).toBe('none');
      expect(r.health).toBe('ok');
      expect(r.missingFields).toEqual([]);
    });

    it('SSO_PROVIDER = "none" → none + ok', () => {
      const r = introspectSsoConfig({ ...BASE_ENV, SSO_PROVIDER: 'none' });
      expect(r.config.provider).toBe('none');
      expect(r.health).toBe('ok');
    });

    it('SSO_PROVIDER 仅空白 → none', () => {
      const r = introspectSsoConfig({ ...BASE_ENV, SSO_PROVIDER: '   ' });
      expect(r.config.provider).toBe('none');
    });

    it('SSO_PROVIDER 大写 NONE → none', () => {
      const r = introspectSsoConfig({ ...BASE_ENV, SSO_PROVIDER: 'NONE' });
      expect(r.config.provider).toBe('none');
    });
  });

  describe('saml', () => {
    it('缺 cert 和 metadata → incomplete + 合成 OR 字段 (codex Minor)', () => {
      // 两者二选一即可；用合成字段名表达，避免 UI 误以为两个都必填
      const r = introspectSsoConfig({ ...BASE_ENV, SSO_PROVIDER: 'saml' });
      expect(r.config.provider).toBe('saml');
      expect(r.health).toBe('incomplete');
      expect(r.missingFields.length).toBe(1);
      expect(r.missingFields[0]).toBe(
        'SAML_IDP_METADATA_URL or SAML_IDP_CERT_FINGERPRINT',
      );
    });

    it('提供 metadata URL → ok', () => {
      const r = introspectSsoConfig({
        ...BASE_ENV,
        SSO_PROVIDER: 'saml',
        SAML_IDP_METADATA_URL: 'https://idp.acme.com/saml/metadata',
      });
      expect(r.config.provider).toBe('saml');
      expect(r.health).toBe('ok');
      expect(r.missingFields).toEqual([]);
      if (r.config.provider === 'saml') {
        expect(r.config.idpMetadataUrl).toBe('https://idp.acme.com/saml/metadata');
        expect(r.config.idpCertFingerprint).toBeNull();
      }
    });

    it('提供 cert fingerprint → ok（无 metadata URL 也行）', () => {
      const r = introspectSsoConfig({
        ...BASE_ENV,
        SSO_PROVIDER: 'saml',
        SAML_IDP_CERT_FINGERPRINT: 'SHA256:aa:bb:cc',
      });
      expect(r.health).toBe('ok');
    });

    it('SP 端 entityId 和 acsUrl 由 NEXT_PUBLIC_APP_URL 生成', () => {
      const r = introspectSsoConfig({
        ...BASE_ENV,
        SSO_PROVIDER: 'saml',
        SAML_IDP_METADATA_URL: 'https://idp/m',
      });
      if (r.config.provider === 'saml') {
        expect(r.config.entityId).toBe('https://aster.acme.internal');
        expect(r.config.acsUrl).toBe(
          'https://aster.acme.internal/api/auth/callback/saml',
        );
      }
    });

    it('NEXT_PUBLIC_APP_URL 带尾斜杠也能处理', () => {
      const r = introspectSsoConfig({
        SSO_PROVIDER: 'saml',
        SAML_IDP_METADATA_URL: 'https://idp/m',
        NEXT_PUBLIC_APP_URL: 'https://aster.acme.internal/',
      });
      if (r.config.provider === 'saml') {
        expect(r.config.entityId).toBe('https://aster.acme.internal');
      }
    });
  });

  describe('oidc', () => {
    it('全缺 → incomplete + missingFields 含 3 项', () => {
      const r = introspectSsoConfig({ ...BASE_ENV, SSO_PROVIDER: 'oidc' });
      expect(r.config.provider).toBe('oidc');
      expect(r.health).toBe('incomplete');
      expect(r.missingFields).toEqual([
        'OIDC_ISSUER',
        'OIDC_CLIENT_ID',
        'OIDC_CLIENT_SECRET',
      ]);
    });

    it('全字段 → ok', () => {
      const r = introspectSsoConfig({
        ...BASE_ENV,
        SSO_PROVIDER: 'oidc',
        OIDC_ISSUER: 'https://idp.acme/oidc',
        OIDC_CLIENT_ID: 'aster-client',
        OIDC_CLIENT_SECRET: 'secret-value',
      });
      expect(r.health).toBe('ok');
      if (r.config.provider === 'oidc') {
        expect(r.config.issuer).toBe('https://idp.acme/oidc');
        expect(r.config.clientId).toBe('aster-client');
        expect(r.config.hasClientSecret).toBe(true);
        // 默认 scopes
        expect(r.config.scopes).toEqual(['openid', 'email', 'profile']);
      }
    });

    it('hasClientSecret 不暴露实际值', () => {
      const r = introspectSsoConfig({
        ...BASE_ENV,
        SSO_PROVIDER: 'oidc',
        OIDC_ISSUER: 'https://idp/oidc',
        OIDC_CLIENT_ID: 'cid',
        OIDC_CLIENT_SECRET: 'super-secret-must-not-leak',
      });
      // 整个 config 序列化后不能含 secret value
      const json = JSON.stringify(r);
      expect(json).not.toContain('super-secret-must-not-leak');
    });

    it('自定义 scopes 解析（逗号分隔 + trim）', () => {
      const r = introspectSsoConfig({
        ...BASE_ENV,
        SSO_PROVIDER: 'oidc',
        OIDC_ISSUER: 'https://idp/oidc',
        OIDC_CLIENT_ID: 'cid',
        OIDC_CLIENT_SECRET: 's',
        OIDC_SCOPES: 'openid , email , groups',
      });
      if (r.config.provider === 'oidc') {
        expect(r.config.scopes).toEqual(['openid', 'email', 'groups']);
      }
    });

    it('callbackUrl 由 NEXT_PUBLIC_APP_URL 生成', () => {
      const r = introspectSsoConfig({
        ...BASE_ENV,
        SSO_PROVIDER: 'oidc',
        OIDC_ISSUER: 'https://idp',
        OIDC_CLIENT_ID: 'c',
        OIDC_CLIENT_SECRET: 's',
      });
      if (r.config.provider === 'oidc') {
        expect(r.config.callbackUrl).toBe(
          'https://aster.acme.internal/api/auth/callback/oidc',
        );
      }
    });
  });

  describe('unknown provider', () => {
    it('未知值 → none + incomplete + 警告 missingFields', () => {
      const r = introspectSsoConfig({ ...BASE_ENV, SSO_PROVIDER: 'azure-ad' });
      expect(r.config.provider).toBe('none');
      expect(r.health).toBe('incomplete');
      expect(r.missingFields[0]).toContain('SSO_PROVIDER');
      expect(r.missingFields[0]).toContain('azure-ad');
    });
  });
});
