// Enterprise license key parser + verifier。
//
// 支持两种格式：
//   v2: `aster-ent-v2-<keyId>-<base64url(payload)>.<base64url(ed25519-signature)>`
//       payload 由 Aster Vault Transit (Ed25519) 签发，公钥从 trust bundle 验证。
//   v1: `aster-ent-<yyyy>-<base64url(payload)>`（PR-8 兼容，无签名）
//       在 30 天兼容窗口内 → trustStatus='legacy-unsigned'；超期 → 'malformed'。
//
// 设计要点：
//   - 状态拆为 3 个内部维度：trustStatus（密码学）× entitlementStatus（生命周期）×
//     connectivityStatus（revocation 拉取健康度）；UI 层通过 deriveDisplayStatus 合成
//     单一 displayStatus（11 种之一），避免在多个 banner 之间堆叠。
//   - 签名校验使用 Web Crypto API Ed25519，原生支持 Cloudflare Workers + Node 24。
//   - 不依赖外部 npm 包；fail-closed：异常路径全部返回 trustStatus !== 'verified'。
//   - hasLicenseFeature 仅在 trustStatus='verified' + entitlementStatus='active' 时返回 true，
//     legacy-unsigned 永远不能用于授权（防 v1 篡改攻击）。

import {
  ASTER_TRUST_BUNDLE,
  type TrustBundleEntry,
} from './license-trust-bundle';
// codex 审查 Major-4：license.ts 是 Workers 兼容代码；prom-client 是 Node-only。
// 用 try-catch 包裹动态 require（Workers runtime 不会 resolve 此模块，silently noop）。
// 真正 metrics 调用在 admin/metrics route 已直接 import license-metrics（Node 路由 OK）。
type RecordVerificationFn = (
  trustStatus: TrustStatus,
  entitlementStatus: EntitlementStatus | null,
) => void;
let recordLicenseVerification: RecordVerificationFn = () => undefined;
try {
  // 仅在 Node 环境成功；Workers / 静态 build 时 require 失败，保持 no-op
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = require('./license-metrics');
  if (m && typeof m.recordLicenseVerification === 'function') {
    recordLicenseVerification = m.recordLicenseVerification;
  }
} catch {
  // Workers / edge runtime 不支持 prom-client；metrics 在 admin/metrics route 仍可用
}

// ===== Status 维度 =====

export type TrustStatus =
  | 'missing' // LICENSE_KEY env 未设置
  | 'malformed' // 格式错 / payload 校验失败 / notBefore 未到 / v1 超出兼容窗口
  | 'legacy-unsigned' // v1 格式 + 仍在 30 天兼容窗口内
  | 'signature-invalid' // 签名校验失败（payload tampered 或算法错误）
  | 'signature-untrusted-key' // keyId 不在 trust bundle 或已 retired
  | 'verified'; // Ed25519 签名校验通过

export type EntitlementStatus =
  | 'active'
  | 'expiring-soon' // 距离 expiresAt < 14 天
  | 'expired'
  | 'revoked';

export type ConnectivityStatus =
  | 'not-applicable' // air-gapped SKU 或尚未启用 revocation 检查
  | 'fresh' // 最近一次 revocation fetch 成功且在 staleness window 内
  | 'grace' // fetch 失败但仍在 7 天 grace 窗口内
  | 'grace-expired' // grace 窗口超出
  | 'error'; // 最新一次拉取出错但尚未进入 grace 状态机

export type DisplayStatus =
  | 'missing'
  | 'malformed'
  | 'legacy-unsigned'
  | 'signature-invalid'
  | 'signature-untrusted-key'
  | 'verified-revoked'
  | 'verified-expired'
  | 'network-grace-expired'
  | 'verified-expiring-soon'
  | 'network-grace'
  | 'verified-active';

export type SecondaryAdvisory =
  | 'expiring-soon'
  | 'revocation-stale'
  | 'network-grace'
  | 'legacy-unsigned-active';

// ===== Payload 与结果 =====

export interface LicensePayloadV2 {
  schemaVersion: 2;
  licenseId: string;
  keyId: string;
  customer: string;
  issuedAt: string;
  expiresAt: string;
  notBefore?: string;
  /** 席位上限：-1 = unlimited，其他必须 > 0 整数。 */
  seatLimit: number;
  tier: 'enterprise' | 'enterprise-plus';
  features: ReadonlyArray<string>;
  sku: 'standard' | 'air-gapped';
  licenseTerm: 'annual' | 'five-year' | 'perpetual';
  /** v2 留作 future-use，必须为 null。 */
  deploymentBinding: null;
  /** standard SKU 必填 HTTPS；air-gapped 允许省略。 */
  revocationCheckUrl?: string;
}

export interface RevocationState {
  isRevoked: boolean;
  revokedAt?: string;
  revokedReason?: string;
  revocationVersion?: number | bigint;
  lastCheckAt?: string;
  lastError?: string;
  connectivityStatus?: ConnectivityStatus;
}

export interface LicenseResult {
  trustStatus: TrustStatus;
  /** trust 失败时为 null（无可判定的 entitlement）。 */
  entitlementStatus: EntitlementStatus | null;
  connectivityStatus: ConnectivityStatus;
  displayStatus: DisplayStatus;
  payload?: LicensePayloadV2;
  /** 脱敏 key 前缀（前 8 个字符 + …）。 */
  keyPreview: string;
  /** active=正数 / expired=负数 / 其他=undefined。 */
  daysRemaining?: number;
  secondaryAdvisories: ReadonlyArray<SecondaryAdvisory>;
  diagnostics: {
    reasonCode?: string;
    signingKeyId?: string;
    fingerprint?: string;
    revocationVersion?: number | bigint;
    lastCheckAt?: string;
    lastError?: string;
  };
}

// ===== v1 legacy 兼容 shape（兼容 PR-8 admin UI / 测试） =====

export type LicenseStatus = 'missing' | 'malformed' | 'expired' | 'active';
export type LicenseVerification = 'unsigned' | 'verified';
export interface LicensePayload {
  customer: string;
  issuedAt: string;
  expiresAt: string;
  seatLimit: number;
  tier: 'enterprise' | 'enterprise-plus';
  features: ReadonlyArray<string>;
}

export interface LegacyLicenseResult {
  status: LicenseStatus;
  verification: LicenseVerification;
  keyPreview: string;
  payload?: LicensePayload;
  reasonCode?:
    | 'env-missing'
    | 'prefix-mismatch'
    | 'base64-decode-failed'
    | 'json-parse-failed'
    | 'payload-shape-invalid';
  daysRemaining?: number;
}

// ===== 常量 =====

const V2_PREFIX = 'aster-ent-v2-';
const V1_KEY_RE = /^aster-ent-(\d{4})-([A-Za-z0-9_-]+)$/;
// keyId / payload 都可能含 '-'，无法用单一 greedy regex 区分 keyId/payload 边界。
// 解析时按 trust bundle 已知 keyId 做最长前缀匹配（见 splitV2Key）。
// payload 与 signature 之间用 '.' 分隔（'.' 不在 base64url 字符集），可安全用 lastIndexOf 切分。
const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRING_SOON_DAYS = 14;
const V1_DEADLINE_WINDOW_MS = 30 * DAY_MS;
const MODULE_LOADED_AT_MS = Date.now();
const V1_DEADLINE_MS = readV1DeadlineMs();

/**
 * v1 兼容窗口截止时间（绝对时间戳，毫秒）。
 *
 * 来源优先级（codex 审查 Major-4：避免 cold-start 漂移）：
 *   1. process.env.LICENSE_V1_DEADLINE（运维显式注入的 ISO 时间）
 *   2. dev / test 模式下回退到 module load + 30d（仅用于本地开发）
 *   3. 生产模式（NODE_ENV='production' 且不在 build phase）下，
 *      若未注入 env 则 fail-closed：返回过去某个时间，v1 一律被拒
 *
 * 生产部署 checklist：必须在 wrangler.toml / .env.production 设置
 *   LICENSE_V1_DEADLINE='2026-12-31T00:00:00.000Z'
 * 否则所有 v1 license 立即失效（这是安全侧的保守 default）。
 */
function readV1DeadlineMs(): number {
  const raw = process.env.LICENSE_V1_DEADLINE;
  if (raw) {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  const isProductionRuntime =
    process.env.NODE_ENV === 'production' &&
    process.env.NEXT_PHASE !== 'phase-production-build';
  if (isProductionRuntime) {
    // Fail-closed：生产没显式设 deadline 就立即拒绝所有 v1
    return 0;
  }
  return MODULE_LOADED_AT_MS + V1_DEADLINE_WINDOW_MS;
}

// ===== 工具函数 =====

function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 8)}…`;
}

function base64ToBytes(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

function base64urlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) {
    throw new Error('invalid-base64url');
  }
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  return JSON.parse(bytesToUtf8(bytes));
}

function isIsoDate(s: string): boolean {
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return false;
  // 必须是 round-trip 一致的 ISO，避免接受 "2026-1-1" 之类非规范输入
  return new Date(ms).toISOString() === s;
}

function isStringArray(value: unknown): value is ReadonlyArray<string> {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

// ===== Payload 校验 =====

function isLegacyPayload(p: unknown): p is LicensePayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (typeof o.customer !== 'string' || o.customer.length === 0) return false;
  if (typeof o.issuedAt !== 'string') return false;
  if (typeof o.expiresAt !== 'string') return false;
  if (typeof o.seatLimit !== 'number' || !Number.isInteger(o.seatLimit)) return false;
  if (o.seatLimit !== -1 && o.seatLimit <= 0) return false;
  if (o.tier !== 'enterprise' && o.tier !== 'enterprise-plus') return false;
  if (!isStringArray(o.features)) return false;
  if (Number.isNaN(Date.parse(o.issuedAt))) return false;
  if (Number.isNaN(Date.parse(o.expiresAt))) return false;
  return true;
}

function isLicensePayloadV2(p: unknown): p is LicensePayloadV2 {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (o.schemaVersion !== 2) return false;
  if (typeof o.licenseId !== 'string' || o.licenseId.length === 0) return false;
  if (typeof o.keyId !== 'string' || o.keyId.length === 0) return false;
  if (typeof o.customer !== 'string' || o.customer.length === 0) return false;
  if (typeof o.issuedAt !== 'string' || !isIsoDate(o.issuedAt)) return false;
  if (typeof o.expiresAt !== 'string' || !isIsoDate(o.expiresAt)) return false;
  if (o.notBefore !== undefined && (typeof o.notBefore !== 'string' || !isIsoDate(o.notBefore))) {
    return false;
  }
  if (typeof o.seatLimit !== 'number' || !Number.isInteger(o.seatLimit)) return false;
  if (o.seatLimit !== -1 && o.seatLimit <= 0) return false;
  if (o.tier !== 'enterprise' && o.tier !== 'enterprise-plus') return false;
  if (!isStringArray(o.features)) return false;
  if (o.sku !== 'standard' && o.sku !== 'air-gapped') return false;
  if (o.licenseTerm !== 'annual' && o.licenseTerm !== 'five-year' && o.licenseTerm !== 'perpetual') {
    return false;
  }
  if (o.deploymentBinding !== null) return false;
  if (o.revocationCheckUrl !== undefined) {
    if (typeof o.revocationCheckUrl !== 'string') return false;
    try {
      if (new URL(o.revocationCheckUrl).protocol !== 'https:') return false;
    } catch {
      return false;
    }
  }
  // standard SKU 必填 revocationCheckUrl；air-gapped 必须省略
  if (o.sku === 'standard' && typeof o.revocationCheckUrl !== 'string') return false;
  if (o.sku === 'air-gapped' && o.revocationCheckUrl !== undefined) return false;
  return true;
}

function findTrustedKeyInBundle(
  bundle: readonly TrustBundleEntry[],
  keyId: string,
): TrustBundleEntry | null {
  return (
    bundle.find((entry) => entry.keyId === keyId && entry.purpose === 'license') ?? null
  );
}

/**
 * 解析 v2 key 三段：keyId / payload / signature。
 *
 * 格式：`aster-ent-v2-<keyId>-<base64url(payload)>.<base64url(signature)>`
 *
 * 因 keyId 与 base64url payload 都可能含 '-'，无法用 greedy regex 切分。
 * 策略：
 *   1. payload 与 sig 用 '.' 分（'.' 不在 base64url 字符集，唯一边界）
 *   2. keyId 与 payload 通过 trust bundle 已知 keyId 做精确前缀匹配：
 *      "v2-<keyId>-<payload>" 中，遍历 bundle 找哪个 keyId 后接 '-' + base64url
 *   3. 找不到匹配 keyId → null（caller 应返回 trustStatus='signature-untrusted-key'）
 *      防止攻击者用任意 hyphen 组合骗解析器走 malformed 分支
 */
function splitV2Key(
  rawAfterPrefix: string,
  bundle: readonly TrustBundleEntry[],
): { keyId: string; payloadB64: string; sigB64: string } | null {
  const dotIdx = rawAfterPrefix.lastIndexOf('.');
  if (dotIdx <= 0 || dotIdx === rawAfterPrefix.length - 1) return null;
  const beforeDot = rawAfterPrefix.slice(0, dotIdx);
  const sigB64 = rawAfterPrefix.slice(dotIdx + 1);
  if (!/^[A-Za-z0-9_-]+$/.test(sigB64)) return null;

  // 在 trust bundle 里找一个 keyId X，使得 beforeDot 形如 "X-<base64url>"
  for (const entry of bundle) {
    if (entry.purpose !== 'license') continue;
    const prefix = `${entry.keyId}-`;
    if (!beforeDot.startsWith(prefix)) continue;
    const payloadB64 = beforeDot.slice(prefix.length);
    if (!/^[A-Za-z0-9_-]+$/.test(payloadB64)) continue;
    return { keyId: entry.keyId, payloadB64, sigB64 };
  }
  return null;
}

// ===== 结果构造 =====

function buildResult(params: {
  trustStatus: TrustStatus;
  entitlementStatus?: EntitlementStatus | null;
  connectivityStatus?: ConnectivityStatus;
  payload?: LicensePayloadV2;
  keyPreview: string;
  daysRemaining?: number;
  reasonCode?: string;
  signingKey?: TrustBundleEntry | null;
  revocationState?: RevocationState | null;
  nowMs?: number;
}): LicenseResult {
  const rawConnectivity = params.connectivityStatus ?? 'not-applicable';
  // air-gapped SKU 强制 not-applicable，作为 deriveDisplayStatus 之外的额外保险
  const effectiveConnectivity =
    params.payload?.sku === 'air-gapped' ? 'not-applicable' : rawConnectivity;
  const entitlementStatus = params.entitlementStatus ?? null;
  const displayStatus = deriveDisplayStatus(
    params.trustStatus,
    entitlementStatus,
    effectiveConnectivity,
    params.payload?.sku ?? null,
  );

  return {
    trustStatus: params.trustStatus,
    entitlementStatus,
    connectivityStatus: effectiveConnectivity,
    displayStatus,
    payload: params.payload,
    keyPreview: params.keyPreview,
    daysRemaining: params.daysRemaining,
    secondaryAdvisories: computeSecondaryAdvisories(
      params.trustStatus,
      entitlementStatus,
      effectiveConnectivity,
      params.nowMs,
    ),
    diagnostics: {
      reasonCode: params.reasonCode,
      signingKeyId: params.signingKey?.keyId,
      fingerprint: params.signingKey?.fingerprint,
      revocationVersion: params.revocationState?.revocationVersion,
      lastCheckAt: params.revocationState?.lastCheckAt,
      lastError: params.revocationState?.lastError,
    },
  };
}

function computeEntitlement(
  payload: LicensePayloadV2,
  now: Date,
  revocationState: RevocationState | null | undefined,
): { entitlementStatus: EntitlementStatus; daysRemaining: number } {
  const expiresAtMs = Date.parse(payload.expiresAt);
  const daysRemaining = Math.floor((expiresAtMs - now.getTime()) / DAY_MS);
  if (revocationState?.isRevoked) return { entitlementStatus: 'revoked', daysRemaining };
  if (daysRemaining < 0) return { entitlementStatus: 'expired', daysRemaining };
  if (daysRemaining < EXPIRING_SOON_DAYS) {
    return { entitlementStatus: 'expiring-soon', daysRemaining };
  }
  return { entitlementStatus: 'active', daysRemaining };
}

// ===== 公开 API =====

/**
 * 校验并解析 LICENSE_KEY env。
 *
 * @param rawKey 原始 env 值（undefined / 空串 = missing）
 * @param opts.now 测试用注入；默认 new Date()
 * @param opts.trustBundle 测试用注入；默认嵌入的 ASTER_TRUST_BUNDLE
 * @param opts.revocationState 由 license-revocation 层提供；PR-L4 会接入
 */
export async function verifyLicenseKey(
  rawKey: string | undefined,
  opts: {
    now?: Date;
    trustBundle?: readonly TrustBundleEntry[];
    revocationState?: RevocationState | null;
  } = {},
): Promise<LicenseResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  // 闭包 wrapper：所有 buildResult 调用自动透传 nowMs，
  // 让 secondaryAdvisories 用与 entitlement 计算相同的时钟（codex Minor-6）
  const build = (params: Parameters<typeof buildResult>[0]) => {
    const result = buildResult({ ...params, nowMs });
    recordLicenseVerification(result.trustStatus, result.entitlementStatus);
    return result;
  };

  if (!rawKey || rawKey.trim() === '') {
    return build({
      trustStatus: 'missing',
      keyPreview: '',
      reasonCode: 'env-missing',
    });
  }

  const trimmed = rawKey.trim();
  const keyPreview = maskKey(trimmed);

  // ----- v1 兼容路径 -----
  if (!trimmed.startsWith(V2_PREFIX)) {
    const legacy = parseLegacyLicenseKey(trimmed, now);
    if (legacy.status === 'malformed' || now.getTime() > V1_DEADLINE_MS) {
      return build({
        trustStatus: 'malformed',
        keyPreview,
        reasonCode: legacy.reasonCode ?? 'v1-deadline-expired',
      });
    }
    const entitlementStatus = legacy.status === 'expired' ? 'expired' : 'active';
    return build({
      trustStatus: 'legacy-unsigned',
      entitlementStatus,
      keyPreview,
      daysRemaining: legacy.daysRemaining,
      reasonCode: 'legacy-unsigned',
    });
  }

  // ----- v2 签名路径 -----
  const bundle = opts.trustBundle ?? ASTER_TRUST_BUNDLE;
  const afterPrefix = trimmed.slice(V2_PREFIX.length);
  const parts = splitV2Key(afterPrefix, bundle);
  if (!parts) {
    // 区分两种 not-parsed 路径：
    //   - 格式整体不合法（无 '.', sig 含非法字符）→ malformed
    //   - 格式合法但 keyId 不在 trust bundle → signature-untrusted-key
    //     （让 audit log 能区分"伪造 + 格式整齐" vs "纯垃圾输入"）
    if (!afterPrefix.includes('.') || !/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(afterPrefix)) {
      return build({
        trustStatus: 'malformed',
        keyPreview,
        reasonCode: 'prefix-mismatch',
      });
    }
    return build({
      trustStatus: 'signature-untrusted-key',
      keyPreview,
      reasonCode: 'unknown-signing-key',
    });
  }
  const { keyId, payloadB64, sigB64 } = parts;
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  let parsed: unknown;
  try {
    payloadBytes = base64urlToBytes(payloadB64);
    sigBytes = base64urlToBytes(sigB64);
    parsed = parseJsonBytes(payloadBytes);
  } catch {
    return build({
      trustStatus: 'malformed',
      keyPreview,
      reasonCode: 'base64-decode-failed',
    });
  }

  if (!isLicensePayloadV2(parsed) || parsed.keyId !== keyId) {
    return build({
      trustStatus: 'malformed',
      keyPreview,
      reasonCode: 'payload-shape-invalid',
    });
  }

  if (parsed.notBefore && now.getTime() < Date.parse(parsed.notBefore)) {
    return build({
      trustStatus: 'malformed',
      keyPreview,
      reasonCode: 'not-before-in-future',
    });
  }

  // splitV2Key 已经按 keyId 在 bundle 里做过 active-purpose='license' 匹配，
  // 这里再次查找是为了拿到完整 entry（fingerprint / status / pubKey）并
  // 拒绝 retired keys（splitV2Key 不区分 status，因为允许 verify-only 走签名验证）。
  const signingKey = findTrustedKeyInBundle(bundle, keyId);
  if (!signingKey || signingKey.status === 'retired') {
    return build({
      trustStatus: 'signature-untrusted-key',
      keyPreview,
      reasonCode: 'unknown-signing-key',
    });
  }

  let verified = false;
  try {
    const publicKeyBytes = base64ToBytes(signingKey.pubKey);
    // 显式拷到独立 ArrayBuffer 满足 Web Crypto 严格 BufferSource 类型
    // （Uint8Array<ArrayBufferLike> 的 buffer 可能是 SharedArrayBuffer）。
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      toArrayBuffer(publicKeyBytes),
      { name: 'Ed25519' },
      false,
      ['verify'],
    );
    verified = await crypto.subtle.verify(
      'Ed25519',
      cryptoKey,
      toArrayBuffer(sigBytes),
      toArrayBuffer(payloadBytes),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return build({
      trustStatus: 'signature-invalid',
      keyPreview,
      reasonCode: /unsupported algorithm/i.test(message)
        ? 'ed25519-unsupported'
        : 'signature-verify-failed',
      signingKey,
    });
  }

  if (!verified) {
    return build({
      trustStatus: 'signature-invalid',
      keyPreview,
      reasonCode: 'signature-mismatch',
      signingKey,
    });
  }

  const { entitlementStatus, daysRemaining } = computeEntitlement(
    parsed,
    now,
    opts.revocationState,
  );

  return build({
    trustStatus: 'verified',
    entitlementStatus,
    connectivityStatus: opts.revocationState?.connectivityStatus ?? 'not-applicable',
    payload: parsed,
    keyPreview,
    daysRemaining,
    signingKey,
    revocationState: opts.revocationState,
  });
}

// ===== Legacy v1 parser（保留兼容性） =====

function parseLegacyLicenseKey(rawKey: string, now: Date): LegacyLicenseResult {
  const keyPreview = maskKey(rawKey);
  const m = V1_KEY_RE.exec(rawKey);
  if (!m) {
    return {
      status: 'malformed',
      verification: 'unsigned',
      keyPreview,
      reasonCode: 'prefix-mismatch',
    };
  }

  let parsed: unknown;
  try {
    parsed = parseJsonBytes(base64urlToBytes(m[2]));
  } catch {
    return {
      status: 'malformed',
      verification: 'unsigned',
      keyPreview,
      reasonCode: 'json-parse-failed',
    };
  }

  if (!isLegacyPayload(parsed)) {
    return {
      status: 'malformed',
      verification: 'unsigned',
      keyPreview,
      reasonCode: 'payload-shape-invalid',
    };
  }

  // 关键：先把 parsed 绑定到 payload（已 narrow 为 LicensePayload），再读 expiresAt。
  const payload: LicensePayload = parsed;
  const expiresAtMs = Date.parse(payload.expiresAt);
  const daysRemaining = Math.floor((expiresAtMs - now.getTime()) / DAY_MS);

  if (daysRemaining < 0) {
    return {
      status: 'expired',
      verification: 'unsigned',
      keyPreview,
      payload,
      daysRemaining,
    };
  }

  return {
    status: 'active',
    verification: 'unsigned',
    keyPreview,
    payload,
    daysRemaining,
  };
}

/**
 * v1 兼容入口，PR-8 admin UI / 旧测试仍可调用。
 * 新代码应一律使用 verifyLicenseKey()，因为它返回签名校验后的可信结果。
 */
export function parseLicenseKey(
  rawKey: string | undefined,
  now: Date = new Date(),
): LegacyLicenseResult {
  if (!rawKey || rawKey.trim() === '') {
    return {
      status: 'missing',
      verification: 'unsigned',
      keyPreview: '',
      reasonCode: 'env-missing',
    };
  }
  return parseLegacyLicenseKey(rawKey.trim(), now);
}

// ===== Display status 派生（pure function） =====

/**
 * 把 (trust, entitlement, connectivity, sku) 4 维状态合成单一 displayStatus。
 *
 * 优先级（plan section 2.3 表）：trust 失败状态 > revoked > expired >
 * network-grace-expired > expiring-soon > network-grace > active。
 * air-gapped SKU 强制 connectivity='not-applicable'，避免 air-gapped 客户
 * 在网络错误时被误显示为 network-grace。
 */
export function deriveDisplayStatus(
  trust: TrustStatus,
  entitlement: EntitlementStatus | null,
  connectivity: ConnectivityStatus,
  sku: 'standard' | 'air-gapped' | null,
): DisplayStatus {
  const effectiveConnectivity = sku === 'air-gapped' ? 'not-applicable' : connectivity;

  if (trust === 'missing') return 'missing';
  if (trust === 'malformed') return 'malformed';
  if (trust === 'signature-invalid') return 'signature-invalid';
  if (trust === 'signature-untrusted-key') return 'signature-untrusted-key';
  if (trust === 'legacy-unsigned') return 'legacy-unsigned';

  // trust === 'verified' 分支
  if (entitlement === 'revoked') return 'verified-revoked';
  if (entitlement === 'expired') return 'verified-expired';
  if (effectiveConnectivity === 'grace-expired') return 'network-grace-expired';
  if (entitlement === 'expiring-soon') return 'verified-expiring-soon';
  if (effectiveConnectivity === 'grace') return 'network-grace';
  return 'verified-active';
}

/**
 * 次要 advisories（UI 在 primary banner 之外以小字 / 列表展示）。
 *
 * 规则：
 *   - 只在 trust='verified' 时考虑 entitlement / connectivity 衍生的 advisory，
 *     避免 missing/malformed 状态下出现毫无意义的 "revocation stale" 提示。
 *   - legacy-unsigned + 已过半 deadline → 提示客户尽快换 v2 key。
 *   - 不重复显示 primary 已经表达的信号（e.g. primary 是 network-grace 就不再
 *     重复加 network-grace advisory）。
 */
export function computeSecondaryAdvisories(
  trust: TrustStatus,
  entitlement: EntitlementStatus | null,
  connectivity: ConnectivityStatus,
  nowMs: number = Date.now(),
): ReadonlyArray<SecondaryAdvisory> {
  const advisories: SecondaryAdvisory[] = [];

  // legacy-unsigned 单独的 advisory：deadline 已过半 → 提示升级
  // nowMs 可注入：测试用确定时间，verifyLicenseKey 已经传入 opts.now
  if (trust === 'legacy-unsigned') {
    const halfwayMs = MODULE_LOADED_AT_MS + (V1_DEADLINE_MS - MODULE_LOADED_AT_MS) / 2;
    if (nowMs > halfwayMs) {
      advisories.push('legacy-unsigned-active');
    }
  }

  // entitlement / connectivity 衍生 advisory 仅在 verified 路径下意义明确
  if (trust !== 'verified') {
    return advisories;
  }

  const displayStatus = deriveDisplayStatus(trust, entitlement, connectivity, 'standard');

  if (entitlement === 'expiring-soon' && displayStatus !== 'verified-expiring-soon') {
    advisories.push('expiring-soon');
  }
  if (
    connectivity === 'error' &&
    displayStatus !== 'network-grace' &&
    displayStatus !== 'network-grace-expired'
  ) {
    advisories.push('revocation-stale');
  }
  if (connectivity === 'grace' && displayStatus !== 'network-grace') {
    advisories.push('network-grace');
  }

  return advisories;
}

// ===== Feature gating =====

/**
 * 检查某 feature flag 是否在 license 中启用。
 *
 * 关键不变量（严格 fail-closed）：
 *   - 仅在 trustStatus='verified' + entitlementStatus='active' 时返回 true
 *   - LegacyLicenseResult（v1 路径）永远返回 false：v1 没有签名保护，
 *     恶意客户可以自己生成 payload 把任意 feature 加进去；调用方如果想
 *     展示 v1 license 内容应该走 UI 渲染层，授权决策**只**用 verifyLicenseKey()
 *     的 v2 结果。
 *   - 这也覆盖 codex 审查 Critical-2：旧 admin UI 用 parseLicenseKey() 仍
 *     可显示 license 内容，但 hasLicenseFeature() 不再为 v1 路径放行授权。
 */
export function hasLicenseFeature(
  result: LicenseResult | LegacyLicenseResult,
  feature: string,
): boolean {
  if (!('trustStatus' in result)) return false;
  if (result.trustStatus !== 'verified') return false;
  if (result.entitlementStatus !== 'active') return false;
  return result.payload?.features.includes(feature) ?? false;
}
