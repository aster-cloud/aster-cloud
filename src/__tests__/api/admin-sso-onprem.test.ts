// /api/admin/sso on-prem 行为：
//   - 非 admin → 404 (silent)
//   - admin + SSO_PROVIDER=none → config.provider=none, health=ok
//   - admin + SSO_PROVIDER=saml + 缺 cert → incomplete

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
  isAdminFromSessionMock: vi.fn(),
}));

vi.mock('@/lib/deployment-mode', () => ({
  CAN_SSO: true,
  IS_SAAS: false,
  IS_ONPREM: true,
}));

vi.mock('@/lib/admin-auth', () => ({
  isAdminFromSession: hoisted.isAdminFromSessionMock,
}));

import { GET } from '@/app/api/admin/sso/route';

describe('/api/admin/sso — on-prem mode', () => {
  let originalProvider: string | undefined;
  let originalMetadata: string | undefined;

  beforeEach(() => {
    originalProvider = process.env.SSO_PROVIDER;
    originalMetadata = process.env.SAML_IDP_METADATA_URL;
    hoisted.isAdminFromSessionMock.mockReset();
  });

  afterEach(() => {
    if (originalProvider === undefined) delete process.env.SSO_PROVIDER;
    else process.env.SSO_PROVIDER = originalProvider;
    if (originalMetadata === undefined) delete process.env.SAML_IDP_METADATA_URL;
    else process.env.SAML_IDP_METADATA_URL = originalMetadata;
  });

  it('non-admin → 404 (silent)', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it('admin + SSO_PROVIDER 未设 → provider=none, ok', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    delete process.env.SSO_PROVIDER;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { provider: string };
      health: string;
    };
    expect(body.config.provider).toBe('none');
    expect(body.health).toBe('ok');
  });

  it('admin + saml + 缺 metadata/cert → incomplete', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    process.env.SSO_PROVIDER = 'saml';
    delete process.env.SAML_IDP_METADATA_URL;
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      config: { provider: string };
      health: string;
      missingFields: string[];
    };
    expect(body.config.provider).toBe('saml');
    expect(body.health).toBe('incomplete');
    expect(body.missingFields[0]).toContain('SAML_IDP_METADATA_URL');
    expect(body.missingFields[0]).toContain('SAML_IDP_CERT_FINGERPRINT');
  });

  it('admin + saml + metadata 配齐 → ok', async () => {
    hoisted.isAdminFromSessionMock.mockResolvedValueOnce({ userId: 'u1' });
    process.env.SSO_PROVIDER = 'saml';
    process.env.SAML_IDP_METADATA_URL = 'https://idp/saml/metadata';
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      health: string;
      config: { provider: string };
    };
    expect(body.config.provider).toBe('saml');
    expect(body.health).toBe('ok');
  });
});
