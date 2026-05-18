// SSO configuration introspection.
//
// 读取 SSO 相关 env，返回结构化配置以供 admin/sso 页面渲染。
//
// 支持的 provider 类型：
//   - 'none'  — SSO 未启用；admin 邀请走 email/password 或 OAuth
//   - 'saml'  — SAML 2.0；管理员配置 IdP metadata + ACS URL
//   - 'oidc'  — OpenID Connect；issuer + client ID/secret
//
// 设计与 license.ts 一致：纯函数 + discriminated union；不依赖 IdP SDK。
//
// 实际签名 / metadata XML 解析、SAML AuthnRequest 等留给后续 PR
// （sso-implementation）。本 PR 只提供 *配置展示* —— operator 能在
// admin UI 看到当前 provider 状态、复制 IdP-required URL 等。

export type SsoProvider = 'none' | 'saml' | 'oidc';

export interface SsoSamlConfig {
  provider: 'saml';
  /** IdP 端要配的 Service Provider Entity ID（通常 = 部署 URL）。 */
  entityId: string;
  /** Assertion Consumer Service URL（IdP 把 SAMLResponse POST 到这里）。 */
  acsUrl: string;
  /** IdP metadata XML 端点（如果 admin 提供了）。 */
  idpMetadataUrl: string | null;
  /** IdP 签名证书指纹（X.509 fingerprint，admin 提供）。 */
  idpCertFingerprint: string | null;
  /** IdP 单点登出 URL（可选）。 */
  idpSloUrl: string | null;
}

export interface SsoOidcConfig {
  provider: 'oidc';
  /** OIDC issuer base URL。 */
  issuer: string;
  /** OAuth callback URL admin 端要配在 IdP。 */
  callbackUrl: string;
  /** Client ID admin 配的。 */
  clientId: string;
  /** 是否配了 client secret（不暴露值，只暴露 boolean）。 */
  hasClientSecret: boolean;
  /** Allowed scopes（默认 openid,email,profile）。 */
  scopes: ReadonlyArray<string>;
}

export interface SsoNoneConfig {
  provider: 'none';
}

export type SsoConfig = SsoNoneConfig | SsoSamlConfig | SsoOidcConfig;

export interface SsoIntrospection {
  /** 当前 provider 模式。 */
  config: SsoConfig;
  /** 配置健康度：'ok' = 必要字段齐全；'incomplete' = 已选 provider 但缺字段。 */
  health: 'ok' | 'incomplete';
  /** 缺失的必填字段名（health='incomplete' 时非空）。 */
  missingFields: ReadonlyArray<string>;
}

/**
 * 输入 env shape —— 用 indexer 而非闭合 interface，因为调用方 `process.env`
 * 类型是 NodeJS.ProcessEnv（包含很多额外字段），传整个对象不可避免；
 * 此接口主要文档化本模块用到的具体字段。
 */
export type SsoEnv = Readonly<Record<string, string | undefined>>;

const DEFAULT_APP_URL = 'https://aster-lang.cloud';

/**
 * 解析 SSO 配置。从 env 读取相关字段；不抛错。
 */
export function introspectSsoConfig(env: SsoEnv = process.env): SsoIntrospection {
  const providerRaw = (env.SSO_PROVIDER ?? '').toLowerCase().trim();
  const appUrl = env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || DEFAULT_APP_URL;

  if (providerRaw === '' || providerRaw === 'none') {
    return {
      config: { provider: 'none' },
      health: 'ok',
      missingFields: [],
    };
  }

  if (providerRaw === 'saml') {
    const config: SsoSamlConfig = {
      provider: 'saml',
      entityId: appUrl,
      acsUrl: `${appUrl}/api/auth/callback/saml`,
      idpMetadataUrl: env.SAML_IDP_METADATA_URL?.trim() || null,
      idpCertFingerprint: env.SAML_IDP_CERT_FINGERPRINT?.trim() || null,
      idpSloUrl: env.SAML_IDP_SLO_URL?.trim() || null,
    };
    const missing: string[] = [];
    if (!config.idpMetadataUrl && !config.idpCertFingerprint) {
      // IdP cert 来源二选一即可 —— 用合成字段名表达"任一即可"
      // 让 UI 不会误显示成"两个都必填"。
      missing.push('SAML_IDP_METADATA_URL or SAML_IDP_CERT_FINGERPRINT');
    }
    return {
      config,
      health: missing.length === 0 ? 'ok' : 'incomplete',
      missingFields: missing,
    };
  }

  if (providerRaw === 'oidc') {
    const config: SsoOidcConfig = {
      provider: 'oidc',
      issuer: env.OIDC_ISSUER?.trim() || '',
      callbackUrl: `${appUrl}/api/auth/callback/oidc`,
      clientId: env.OIDC_CLIENT_ID?.trim() || '',
      hasClientSecret: !!env.OIDC_CLIENT_SECRET?.trim(),
      scopes: (env.OIDC_SCOPES?.split(',').map((s) => s.trim()).filter(Boolean) ?? [
        'openid',
        'email',
        'profile',
      ]) as ReadonlyArray<string>,
    };
    const missing: string[] = [];
    if (!config.issuer) missing.push('OIDC_ISSUER');
    if (!config.clientId) missing.push('OIDC_CLIENT_ID');
    if (!config.hasClientSecret) missing.push('OIDC_CLIENT_SECRET');
    return {
      config,
      health: missing.length === 0 ? 'ok' : 'incomplete',
      missingFields: missing,
    };
  }

  // 未知 provider 值（如 'azure-ad', 'okta'）—— 视为 none + 警告
  return {
    config: { provider: 'none' },
    health: 'incomplete',
    missingFields: [`SSO_PROVIDER (unknown value: ${providerRaw})`],
  };
}
