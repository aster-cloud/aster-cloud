// P0-A S1（信任层5 transition authorization）：cloud 侧验签 aster-deploy signing-api 用**独立 Vault
// Transit key**（regression-transition-signing-*）签的 upgrade-manifest。
//
// ★铁律边界（承 PR-A + Codex 定的 PR-B 契约）：
//   (1) 公钥**只**从受信 regression-transition 集合解析（findTrustedKey(keyId, 'regression-transition')），
//       **绝不**信工件自报的 keyId 去动态解析别的信任根（keyId 只用于在受信集内选条目，选不到即 untrusted）；
//   (2) Ed25519 验签（复用 license.ts 同款 Web Crypto 原语，Node + CF Workers 通用）；
//   (3) 验签**后**必须 re-assert canonical payload 里的 purpose==='regression-transition'（signing-api 已
//       强制被签 payload 自证 purpose + X≠Y，cloud 读取时仍须再断言，防宽松解释）；
//   (4) X≠Y 方向性（升级必须有方向）。
//
// ★S1 不解锁签字：验签通过只证「有主体批准了 X→Y 方向升级」（层5），**不**证明实际执行环境是 X/Y（层3）。
//   调用方（rule-regression-runner）据此挂「已批准升级」证据，但**绝不**因此移除 TOOLCHAIN_PROVENANCE_UNVERIFIED。

import { findTrustedKey, type TrustBundleEntry } from '@/lib/license-trust-bundle';

/** 被签的 upgrade-manifest（与 aster-deploy signing-api 的 RegressionTransitionManifestSchema 对齐）。 */
export interface RegressionTransitionManifest {
  schemaVersion: 1;
  purpose: 'regression-transition';
  baselineToolchainId: string; // X
  currentToolchainId: string; // Y
  policyId: string;
  approvedBy: string;
  /** ★钉死针对的报告内容（防合法签名重放到别的报告）。**必填**（Codex 复审 P0）。 */
  reportHash: string;
  /** ★有效期进签名体（防延寿：存储 expiresAt 须 == 签名体）。**必填**（Codex 复审 P0/P1）。ISO 串。 */
  expiresAt: string;
  [k: string]: unknown; // 前向兼容附加字段（signing-api passthrough）。
}

export type TransitionVerifyStatus =
  | 'verified' // 签名有效 + 受信 active/verify-only key + manifest 自洽（purpose + 方向）
  | 'untrusted-key' // keyId 不在受信 regression-transition 集，或 retired
  | 'signature-invalid' // Ed25519 验签失败
  | 'manifest-invalid' // canonical payload 非法 manifest（purpose 错 / 缺字段 / X===Y）
  | 'malformed'; // 输入格式坏（base64/JSON 解析失败）

export interface TransitionVerifyResult {
  status: TransitionVerifyStatus;
  /** 验签通过时的 manifest（其余状态为 null）。 */
  manifest: RegressionTransitionManifest | null;
  /** 命中的受信 key（诊断用）。 */
  signingKey: TrustBundleEntry | null;
  /** 具体拒因（审计/UI）。 */
  reason?: string;
}

// ── 自包含 helper（不改 license.ts；与其 base64ToBytes/toArrayBuffer/base64urlToBytes 逐字节等价）──

function base64ToBytes(s: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
  const binary = atob(s);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64urlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('invalid-base64url');
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** 校验解析后的对象是否合法 manifest（purpose + 必需字段 + X≠Y 方向）。 */
function parseManifest(obj: unknown): RegressionTransitionManifest | null {
  if (!obj || typeof obj !== 'object') return null;
  const m = obj as Record<string, unknown>;
  if (m.schemaVersion !== 1) return null;
  if (m.purpose !== 'regression-transition') return null;
  // ★reportHash + expiresAt 必填（Codex 复审 P0：否则合法签名可跨报告重放/延寿）。
  const strFields = ['baselineToolchainId', 'currentToolchainId', 'policyId', 'approvedBy', 'reportHash', 'expiresAt'] as const;
  for (const f of strFields) {
    if (typeof m[f] !== 'string' || (m[f] as string).length === 0) return null;
  }
  // ★方向性：X≠Y（升级必须有方向；baseline===current 不是升级）。
  if (m.baselineToolchainId === m.currentToolchainId) return null;
  return m as unknown as RegressionTransitionManifest;
}

/**
 * 验签一个 signing-api 产出的 upgrade-manifest。
 *
 * @param keyId 工件自报的 signing keyId（**只**用于在受信 regression-transition 集内选条目）。
 * @param canonicalPayloadB64url signing-api 返回的 canonicalPayload（base64url），= 被签的确切字节。
 * @param signatureB64url signing-api 返回的 Ed25519 签名（base64url）。
 */
export async function verifyRegressionTransition(
  keyId: string,
  canonicalPayloadB64url: string,
  signatureB64url: string,
): Promise<TransitionVerifyResult> {
  // (1) 只从受信 regression-transition 集解析公钥——不信工件自报 keyId 去别处。
  const signingKey = findTrustedKey(keyId, 'regression-transition');
  if (!signingKey || signingKey.status === 'retired') {
    return { status: 'untrusted-key', manifest: null, signingKey: signingKey ?? null, reason: 'unknown-or-retired-signing-key' };
  }

  // 解码输入。
  let payloadBytes: Uint8Array;
  let sigBytes: Uint8Array;
  try {
    payloadBytes = base64urlToBytes(canonicalPayloadB64url);
    sigBytes = base64urlToBytes(signatureB64url);
  } catch {
    return { status: 'malformed', manifest: null, signingKey, reason: 'base64url-decode-failed' };
  }

  // (2) Ed25519 验签（复用 license.ts 同款 Web Crypto 原语）。
  let verified = false;
  try {
    const pubBytes = base64ToBytes(signingKey.pubKey);
    const cryptoKey = await crypto.subtle.importKey('raw', toArrayBuffer(pubBytes), { name: 'Ed25519' }, false, ['verify']);
    verified = await crypto.subtle.verify('Ed25519', cryptoKey, toArrayBuffer(sigBytes), toArrayBuffer(payloadBytes));
  } catch (err) {
    return { status: 'signature-invalid', manifest: null, signingKey, reason: err instanceof Error ? err.message : 'verify-error' };
  }
  if (!verified) {
    return { status: 'signature-invalid', manifest: null, signingKey, reason: 'signature-mismatch' };
  }

  // (3)+(4) 验签通过 → 解析被签字节为 manifest 并 re-assert purpose + 方向（防宽松解释）。
  let obj: unknown;
  try {
    obj = JSON.parse(bytesToUtf8(payloadBytes));
  } catch {
    return { status: 'malformed', manifest: null, signingKey, reason: 'signed-payload-not-json' };
  }
  const manifest = parseManifest(obj);
  if (!manifest) {
    return { status: 'manifest-invalid', manifest: null, signingKey, reason: 'signed-payload-not-valid-manifest' };
  }

  return { status: 'verified', manifest, signingKey };
}
