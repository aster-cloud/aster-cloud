// SaaS-side client for the aster-deploy license-signing-api 2-person
// approve+sign protocol.
//
// 设计意图：
//   - 现有 aster-deploy/services/license-signing-api 暴露 /v1/approve +
//     /v1/sign，要求 operator JWT（approve）+ operator+witness JWT（sign）。
//     本模块封装两个 service-account JWT 完成自动续约：webhook handler
//     调 signLicensePayload(payload) → 返回 `aster-ent-v2-...` 完整 key。
//   - 两个 svc account（billing-operator-svc / billing-witness-svc）来自
//     独立的 OIDC issuer (BILLING_JWT_*)，不和 ops 人工 ceremony 共享
//     trust path。signing-api 端启用第二个 JWKS URL 并按 sub 区分。
//   - JWT 由本进程 mint，私钥从 env (BILLING_*_PRIVATE_KEY_PKCS8) 读。
//     prod 部署经 Vault secret injector 注入；dev 走 PEM env。
//
// SaaS-only：on-prem build 永远不应触发这条路径。模块文件标注
// hot-gate marker 让 verify-on-prem-bundle + ESLint 都识别为 SaaS 专属。

/* @deployment-mode-hot-gate
 * reason: SaaS 端续约 portal 调 aster-deploy signing-api 签发 license；
 *         on-prem build 不该 reach here，用 macro 让 dead branch DCE 彻底
 *         消除 BILLING_*_PRIVATE_KEY_PKCS8 env 引用 (避免 bundle 泄漏)。
 */

import { createHash, KeyObject, createPrivateKey, sign as cryptoSign } from 'node:crypto';
import { IS_SAAS } from '@/lib/deployment-mode';

declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';

// ───────── Types ─────────

export interface SignedLicenseResult {
  /** Full `aster-ent-v2-<keyId>-<payloadB64url>.<sigB64url>` license key. */
  licenseKey: string;
  /** sha256 of canonical payload bytes; useful for audit + IssuedLicense.payload_hash. */
  payloadHash: string;
  /** Vault Transit key version that signed (e.g. "1"). */
  keyVersion: string;
  /** Echo of canonical payload bytes (base64url) — same bytes the verifier hashes. */
  canonicalPayloadB64url: string;
}

/** signing-api 支持的 purpose（与 aster-deploy signing-api PurposeSchema 对齐）。 */
export type SigningPurpose = 'license' | 'revocation' | 'regression-transition';

export interface SigningClientConfig {
  baseUrl: string;
  signingKeyId: string;
  /**
   * ★P0-A S1：签名 purpose（默认 'license'，向后兼容——现有 license 调用不传即 license）。
   * regression-transition 用独立 keyId（密钥分离），signing-api 按 purpose↔key 前缀强制绑定。
   */
  purpose?: SigningPurpose;
  /** JWT issuer the signing-api expects (configured via BILLING_JWT_ISSUER on server). */
  issuer: string;
  /** JWT audience the signing-api enforces (e.g. 'aster-license-signing-api'). */
  audience: string;
  operatorSub: string;
  witnessSub: string;
  /** PKCS8 PEM, the matching pub key is published in BILLING_JWT_JWKS_URL. */
  operatorPrivateKeyPem: string;
  /** Distinct key from operator's (different sub, different rotation). */
  witnessPrivateKeyPem: string;
  /** JWT kid hint for downstream JWKS resolution. */
  operatorKid: string;
  witnessKid: string;
  /** Per-call fetch timeout (defaults to 10s). */
  timeoutMs?: number;
}

// ───────── Module-load env wiring (eager so misconfig fails fast in SaaS) ─────────

function loadConfigFromEnv(): SigningClientConfig {
  const required = (name: string): string => {
    const v = process.env[name];
    if (!v || v.trim() === '') {
      throw new Error(
        `[license-signing-client] missing env ${name} (SaaS-only; configure via Vault secret injector in prod)`,
      );
    }
    return v.trim();
  };

  return {
    baseUrl: required('LICENSE_SIGNING_API_URL').replace(/\/+$/, ''),
    signingKeyId: required('LICENSE_SIGNING_KEY_ID'),
    issuer: required('BILLING_JWT_ISSUER'),
    audience: required('BILLING_JWT_AUDIENCE'),
    operatorSub: required('BILLING_OPERATOR_SUB'),
    witnessSub: required('BILLING_WITNESS_SUB'),
    operatorPrivateKeyPem: required('BILLING_OPERATOR_PRIVATE_KEY_PKCS8'),
    witnessPrivateKeyPem: required('BILLING_WITNESS_PRIVATE_KEY_PKCS8'),
    operatorKid: required('BILLING_OPERATOR_KID'),
    witnessKid: required('BILLING_WITNESS_KID'),
    timeoutMs: Number.parseInt(process.env.LICENSE_SIGNING_TIMEOUT_MS ?? '10000', 10),
  };
}

let _config: SigningClientConfig | null = null;
function getConfig(): SigningClientConfig {
  if (!_config) _config = loadConfigFromEnv();
  return _config;
}

// ───────── JWT helpers (RS256, no external deps) ─────────

function b64url(input: Uint8Array | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Mint short-lived RS256 JWT. Lifetime is capped at 5 minutes so even if a
 * token leaks via logs the blast radius is tiny — far shorter than human
 * ceremony's typical 4-hour TTL because automated path has zero excuse to
 * sit around.
 */
function mintJwt(args: {
  sub: string;
  role: 'license-operator' | 'license-witness';
  privateKeyPem: string;
  kid: string;
  issuer: string;
  audience: string;
  lifetimeSeconds?: number;
}): string {
  const lifetime = Math.min(args.lifetimeSeconds ?? 300, 600);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: args.kid };
  const payload = {
    iss: args.issuer,
    aud: args.audience,
    sub: args.sub,
    role: args.role,
    iat: now,
    nbf: now - 1,
    exp: now + lifetime,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key: KeyObject = createPrivateKey(args.privateKeyPem);
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signingInput, 'utf8'), key);
  return `${signingInput}.${b64url(signature)}`;
}

// ───────── Canonical JSON (matches aster-deploy canonicalStringify) ─────────

/**
 * Stable JSON serializer — sorts object keys recursively, strips
 * surrounding whitespace. Must byte-match
 * services/license-signing-api/src/canonical-json.ts::canonicalStringify
 * because signing-api hashes the bytes it receives, and verify on-prem
 * hashes the bytes shipped in the license key. Any divergence → signature
 * fails verification.
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify(obj[k])}`);
  return `{${parts.join(',')}}`;
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

// ───────── Public API ─────────

/**
 * Sign a license payload via the 2-person approve+sign protocol against the
 * aster-deploy signing-api. Returns the full license key (caller should
 * persist payload_hash / vault key version into IssuedLicense and email
 * the key to the customer — license key bytes never persisted).
 *
 * Throws if signing-api returns non-2xx, JSON shape invalid, or network
 * times out. Caller is responsible for retry / DLQ semantics.
 */
export async function signLicensePayload(
  payload: Record<string, unknown>,
  overrides: Partial<SigningClientConfig> = {},
): Promise<SignedLicenseResult> {
  // Hot gate: this module must never execute in on-prem build. The literal
  // macro guard lets terser fold the entire body to a throw in production
  // builds, eliminating BILLING_* env references from the on-prem bundle.
  // In test / dev (no DefinePlugin) the macro is undefined; we fall back
  // to the helper constant which honors process.env.DEPLOYMENT_MODE.
  if (typeof __DEPLOYMENT_MODE__ !== 'undefined' && __DEPLOYMENT_MODE__ !== 'saas') {
    throw new Error('[license-signing-client] unavailable in on-prem build');
  }
  if (!IS_SAAS) {
    throw new Error('[license-signing-client] IS_SAAS=false; refusing to call signing-api');
  }
  const cfg: SigningClientConfig = { ...getConfig(), ...overrides };
  const raw = await signPayloadRaw(payload, cfg);

  // Reconstruct full license key. signing-api returns canonicalPayload
  // already b64url-encoded — same bytes verifier feeds to crypto.verify.
  const licenseKey = `aster-ent-v2-${cfg.signingKeyId}-${raw.canonicalPayloadB64url}.${raw.signature}`;
  return {
    licenseKey,
    payloadHash: raw.payloadHash,
    keyVersion: raw.keyVersion,
    canonicalPayloadB64url: raw.canonicalPayloadB64url,
  };
}

/** 原始签名结果（无 license-key envelope 重组）——manifest 签发直接持久化这些字段。 */
export interface RawSignResult {
  canonicalPayloadB64url: string;
  signature: string;
  keyVersion: string;
  /** sha256(canonical payload bytes) hex——审计 / artifact hash。 */
  payloadHash: string;
}

/**
 * ★共享 2-人 approve+sign 核心（purpose-无关）。签任意 payload，返回原始签名结果（不含 license
 * envelope）。license 走 signLicensePayload（在此之上重组 aster-ent-v2- key）；regression-transition
 * 走 signRegressionTransition（直接用原始结果）。cfg.purpose 决定 signing-api 分派（license/regression-
 * transition）+ keyId 前缀绑定（密钥分离）。
 */
async function signPayloadRaw(
  payload: Record<string, unknown>,
  cfg: SigningClientConfig,
): Promise<RawSignResult> {
  const purpose: SigningPurpose = cfg.purpose ?? 'license';
  const timeoutMs = cfg.timeoutMs ?? 10_000;

  const operatorJwt = mintJwt({
    sub: cfg.operatorSub,
    role: 'license-operator',
    privateKeyPem: cfg.operatorPrivateKeyPem,
    kid: cfg.operatorKid,
    issuer: cfg.issuer,
    audience: cfg.audience,
  });

  // /v1/approve — operator-only path
  const approveRes = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/approve`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operator-jwt': operatorJwt,
      },
      body: JSON.stringify({
        purpose,
        keyId: cfg.signingKeyId,
        payload,
      }),
    },
    timeoutMs,
  );
  if (!approveRes.ok) {
    throw new SigningApiError('approve', approveRes.status, await approveRes.text());
  }
  const approveBody = (await approveRes.json()) as { approvalToken?: string };
  if (!approveBody.approvalToken || !/^[0-9a-f]{64}$/.test(approveBody.approvalToken)) {
    throw new Error('[license-signing-client] /v1/approve returned malformed approvalToken');
  }

  // /v1/sign — operator+witness 双 JWT
  const witnessJwt = mintJwt({
    sub: cfg.witnessSub,
    role: 'license-witness',
    privateKeyPem: cfg.witnessPrivateKeyPem,
    kid: cfg.witnessKid,
    issuer: cfg.issuer,
    audience: cfg.audience,
  });
  const signRes = await fetchWithTimeout(
    `${cfg.baseUrl}/v1/sign`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-operator-jwt': operatorJwt,
        'x-witness-jwt': witnessJwt,
      },
      body: JSON.stringify({
        purpose,
        keyId: cfg.signingKeyId,
        payload,
        approvalToken: approveBody.approvalToken,
      }),
    },
    timeoutMs,
  );
  if (!signRes.ok) {
    throw new SigningApiError('sign', signRes.status, await signRes.text());
  }
  const signBody = (await signRes.json()) as {
    signature?: string;
    keyVersion?: string;
    canonicalPayload?: string;
  };
  if (!signBody.signature || !signBody.canonicalPayload || !signBody.keyVersion) {
    throw new Error('[license-signing-client] /v1/sign returned incomplete body');
  }

  // signing-api 返回 canonicalPayload 已 b64url——即 verifier 喂给 crypto.verify 的确切字节。
  const canonicalBytes = Buffer.from(signBody.canonicalPayload, 'base64url');
  const payloadHash = sha256Hex(canonicalBytes.toString('utf8'));
  return {
    canonicalPayloadB64url: signBody.canonicalPayload,
    signature: signBody.signature,
    keyVersion: signBody.keyVersion,
    payloadHash,
  };
}

/**
 * ★P0-A S1：签一个 regression-transition upgrade-manifest（信任层5）。复用共享 2-人 ceremony
 * （signPayloadRaw），purpose='regression-transition' + 独立 keyId（密钥分离）。返回**原始**签名结果
 * （无 license envelope）——调用方持久化 {canonicalPayloadB64url, signature, keyVersion, keyId}，
 * cloud 侧用 verifyRegressionTransition 验签。
 *
 * config 从独立 env 载（REGRESSION_TRANSITION_SIGNING_KEY_ID + 复用 LICENSE_SIGNING_API_URL/BILLING_* JWT
 * ——2-人 ceremony 身份共享，密钥分离靠 keyId+purpose）。overrides 供测试注入。
 */
export async function signRegressionTransition(
  manifest: Record<string, unknown>,
  overrides: Partial<SigningClientConfig> = {},
): Promise<RawSignResult & { keyId: string }> {
  if (typeof __DEPLOYMENT_MODE__ !== 'undefined' && __DEPLOYMENT_MODE__ !== 'saas') {
    throw new Error('[license-signing-client] regression-transition signing unavailable in on-prem build');
  }
  if (!IS_SAAS) {
    throw new Error('[license-signing-client] IS_SAAS=false; refusing to call signing-api');
  }
  const base = getConfig();
  const cfg: SigningClientConfig = {
    ...base,
    // 独立 keyId（密钥分离）。默认从专用 env；未配则回落到显式 override（测试）。
    signingKeyId: (process.env.REGRESSION_TRANSITION_SIGNING_KEY_ID ?? base.signingKeyId).trim(),
    purpose: 'regression-transition',
    ...overrides,
  };
  const raw = await signPayloadRaw(manifest, cfg);
  return { ...raw, keyId: cfg.signingKeyId };
}

// ───────── Errors + fetch helpers ─────────

export class SigningApiError extends Error {
  constructor(
    public readonly endpoint: 'approve' | 'sign',
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`[license-signing-client] ${endpoint} returned ${status}: ${body.slice(0, 200)}`);
    this.name = 'SigningApiError';
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ───────── Test helpers (allow injecting fake config) ─────────

/** @internal — only for unit tests. */
export function __setConfigForTests(cfg: SigningClientConfig | null): void {
  if (process.env.VITEST !== 'true' && process.env.NODE_ENV !== 'test') {
    throw new Error('__setConfigForTests called outside test runtime');
  }
  _config = cfg;
}
