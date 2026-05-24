// Trust bundle：嵌入 build 的 Aster 公钥集合，用于离线验证 license + revocation 签名。
//
// 设计要点：
//   - 公钥按 keyId 唯一识别，同一 keyId 在同一 bundle 内不允许重复
//   - purpose 严格分离 license 与 revocation；查找时必须匹配两者
//   - status='active' 可签发新 license；'verify-only' 仅用于校验旧 license；
//     'retired' 视为不可信（rotation policy 中等待所有相关 license 过期后才移除）
//   - 生产 build 必须通过 release pipeline 用 Vault 提取的真实公钥替换 __dev-* 占位
//     （aster-deploy/docs/license-key-ceremony.md 第 4 节）；本模块在 NODE_ENV=production
//     时若发现 bundle 仍为 dev 占位会 throw，阻止启动

export type TrustBundleEntryStatus = 'active' | 'verify-only' | 'retired';
export type TrustBundleEntryPurpose = 'license' | 'revocation';

export interface TrustBundleEntry {
  /** 例如 'lic-2026-01'，与 Vault transit key name 对应。 */
  keyId: string;
  purpose: TrustBundleEntryPurpose;
  /** Ed25519 raw 公钥的 base64 编码（32 字节解码后）。 */
  pubKey: string;
  status: TrustBundleEntryStatus;
  /** 何时进入 trust bundle（ISO date）。 */
  activatedAt: string;
  /** 退役时间，仅 status='retired' 时非空。 */
  retiredAt?: string;
  /** SHA-256(pubKey bytes) hex，用于审计 / UI 显示与纸质 ceremony 记录核对。 */
  fingerprint: string;
}

// DEV 占位公钥。⚠️ 不可使用 all-zero / 全零 base64！全零 Ed25519 公钥是
// small-order point，配上 all-zero 签名可以伪签任意 message
// （Node 24 Web Crypto verify(zeroKey, zeroSig, anyMsg) === true）。
//
// 这里嵌入两把 *真实* 的 Ed25519 公钥；对应私钥在 ceremony 之外随脚本
// 进程退出即被销毁，永远不存在于磁盘 / 记忆中。任何攻击者无法构造能通过
// 这些公钥验证的签名。生产 build 仍必须通过 release pipeline 用 Vault 提取
// 的真实公钥替换 __dev-* 条目（aster-deploy/docs/license-key-ceremony.md 第 4 节）。
const DEV_LIC_PUBKEY = 'fORwuPo6Zki2lcOcHMp+DLhR/Tl8vpF6arqKd3zrxHg=';
const DEV_LIC_FINGERPRINT =
  '7f47fac5b4cf608baf1a5658bbf4f21a34ba4ed10fe7772dfafb26e1c7bdbbda';
const DEV_REV_PUBKEY = 'SSeCAGEh4Ko0poy4qq8HO1p+43yKeRUWwxwlHg2zkVg=';
const DEV_REV_FINGERPRINT =
  'c3f2bce0cefb3b4f43b5e5e409d8960fa5c770dee678782fc61db110c6fecfd9';

// 已知 Ed25519 small-order 公钥（应被显式拒绝以防 forgery）
// 来源：cryptography.io / RFC 8032 附录 A.3 列出的低阶 generator
const KNOWN_LOW_ORDER_PUBKEYS: ReadonlySet<string> = new Set([
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // all zeros
  'AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', // 0x01 followed by zeros
  '7P///////////////////////////////////////38=', // RFC 8032 known order-2
  '7v///////////////////////////////////////38=',
  'XOcCqGY6moRZqAcg++qXa4P5pQ3lkF8Y6vRTNNn/8j8=',
]);

// Base bundle baked into the binary. Release pipeline rewrites the
// __dev-* entries to real Vault-extracted public keys (see
// license-key-ceremony.md §4) before producing the on-prem image.
const BASE_BUNDLE: readonly TrustBundleEntry[] = [
  {
    keyId: '__dev-lic-2026-01__',
    purpose: 'license',
    pubKey: DEV_LIC_PUBKEY,
    status: 'active',
    activatedAt: '2026-01-01T00:00:00.000Z',
    fingerprint: DEV_LIC_FINGERPRINT,
  },
  {
    keyId: '__dev-rev-2026-01__',
    purpose: 'revocation',
    pubKey: DEV_REV_PUBKEY,
    status: 'active',
    activatedAt: '2026-01-01T00:00:00.000Z',
    fingerprint: DEV_REV_FINGERPRINT,
  },
] as const;

// E2E hook: ASTER_TEST_TRUST_BUNDLE_EXTRA carries a JSON array of
// extra TrustBundleEntry objects to append at module load. Required
// for the on-prem license-flow E2E harness in
// docs/on-prem/testing/, where we mint our own Ed25519 keypair, sign
// a license payload locally, then need the freshly-generated public
// key to be recognized by the verify path.
//
// Two safety guards stack:
//
//   1. ASTER_ALLOW_DEV_TRUST_BUNDLE=true required. Without it the
//      env-injection path throws — no silent trust-bundle extension
//      from env in any runtime.
//
//   2. NODE_ENV=production is a hard veto. Even if allow-dev is set,
//      env injection is refused in a production-shaped runtime. This
//      closes the post-b7f61db attack surface where an operator with
//      pod-exec access could flip both envs and inject their own
//      signing pubkey. The harness only runs in NODE_ENV=development
//      anyway (release-pipeline production builds replace __dev-*
//      keys with Vault-extracted pubkeys, so the test hook isn't
//      needed at all in real prod).
//
// SaaS builds never set either env (SaaS doesn't reach the verify
// path; the trust bundle exists purely for on-prem licence checks).
// Production on-prem deployments must not set either env; if they do,
// guard 2 short-circuits, and even if NODE_ENV is wrong, the
// dev-placeholder assert below catches a production runtime that still
// contains __dev-* entries.
function readExtraBundle(): readonly TrustBundleEntry[] {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  const raw = env?.ASTER_TEST_TRUST_BUNDLE_EXTRA;
  if (!raw) return [];
  const allowDev = env?.ASTER_ALLOW_DEV_TRUST_BUNDLE === 'true';
  if (!allowDev) {
    throw new Error(
      '[license-trust-bundle] ASTER_TEST_TRUST_BUNDLE_EXTRA is set but ' +
        'ASTER_ALLOW_DEV_TRUST_BUNDLE is not "true". Refusing to extend the ' +
        'trust bundle from env in a production-shaped runtime.',
    );
  }
  // Hard veto: env injection is never honored in a production runtime,
  // even with allow-dev. Read NODE_ENV via the same indirection trick
  // the dev-key assert uses (defeats webpack DefinePlugin's compile-
  // time replacement; see the assert comment below).
  if (env?.NODE_ENV === 'production') {
    throw new Error(
      '[license-trust-bundle] ASTER_TEST_TRUST_BUNDLE_EXTRA cannot be honored ' +
        'when NODE_ENV=production, even with ASTER_ALLOW_DEV_TRUST_BUNDLE=true. ' +
        'This env exists solely for development-only license-ceremony dry-runs ' +
        '(see docs/on-prem/testing/README.md). For production on-prem deploys, ' +
        'the release pipeline must embed real Vault-extracted pubkeys into the ' +
        'base trust bundle (license-key-ceremony.md §4).',
    );
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('ASTER_TEST_TRUST_BUNDLE_EXTRA must be a JSON array');
    }
    return parsed as TrustBundleEntry[];
  } catch (err) {
    throw new Error(
      `[license-trust-bundle] ASTER_TEST_TRUST_BUNDLE_EXTRA parse failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export const ASTER_TRUST_BUNDLE: readonly TrustBundleEntry[] = [
  ...BASE_BUNDLE,
  ...readExtraBundle(),
];

function assertUniqueKeyIds(bundle: readonly TrustBundleEntry[]): void {
  const seen = new Set<string>();
  for (const entry of bundle) {
    if (seen.has(entry.keyId)) {
      throw new Error(
        `[license-trust-bundle] duplicate keyId: ${entry.keyId}`,
      );
    }
    seen.add(entry.keyId);
  }
}

function assertNoLowOrderPubKeys(bundle: readonly TrustBundleEntry[]): void {
  for (const entry of bundle) {
    if (KNOWN_LOW_ORDER_PUBKEYS.has(entry.pubKey)) {
      throw new Error(
        `[license-trust-bundle] entry ${entry.keyId} uses a known small-order Ed25519 public key; this is unsafe (verify can accept forged signatures)`,
      );
    }
  }
}

function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, '0');
  }
  return out;
}

/**
 * Defense-in-depth check: every entry's `fingerprint` field must equal
 * `sha256(base64-decode(pubKey))` rendered as lowercase hex. Both fields
 * are baked into the binary by the release pipeline; they're redundant
 * by design so any partial tampering (e.g. an attacker swaps pubKey
 * bytes but doesn't recompute fingerprint, or swaps fingerprint but
 * misses a pubKey edit elsewhere) is caught at module load instead of
 * silently letting the verify path accept the swapped key.
 *
 * Async because we lean on Web Crypto (works in both Node and the
 * Cloudflare Workers runtime). Module top-level `await` is supported
 * in our ESM target. If this assert ever blocks startup latency the
 * fingerprint count is so small (handful of entries) that the cost is
 * well under a millisecond.
 */
async function assertFingerprintsMatch(
  bundle: readonly TrustBundleEntry[],
): Promise<void> {
  for (const entry of bundle) {
    let pubBytes: Uint8Array;
    try {
      pubBytes = base64ToBytes(entry.pubKey);
    } catch (err) {
      throw new Error(
        `[license-trust-bundle] entry ${entry.keyId} pubKey is not valid base64: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    const digest = await crypto.subtle.digest('SHA-256', pubBytes as BufferSource);
    const actual = bytesToHex(new Uint8Array(digest));
    if (actual !== entry.fingerprint.toLowerCase()) {
      throw new Error(
        `[license-trust-bundle] entry ${entry.keyId} fingerprint mismatch: ` +
          `declared ${entry.fingerprint}, computed ${actual}. Bundle has been ` +
          `tampered with (or the release pipeline output is corrupt).`,
      );
    }
  }
}

assertUniqueKeyIds(ASTER_TRUST_BUNDLE);
assertNoLowOrderPubKeys(ASTER_TRUST_BUNDLE);
await assertFingerprintsMatch(ASTER_TRUST_BUNDLE);

// 生产 runtime 必须没有 *任何* dev 占位（some 而非 every），否则混合的 dev key
// 仍然会成为 verify 的可信路径（codex 审查 Major-5）。
//
// SaaS exception: the trust bundle exists only to verify on-prem licenses.
// A SaaS build never reaches the verify path (isLicenseReadOnlyGated()
// short-circuits on IS_SAAS), but admin/layout.tsx imports
// license-runtime-gate which transitively imports this module — so the
// module-load-time assertion below would crash every /admin/* page on a
// SaaS prod build that still ships the dev placeholder bundle. We
// skip the assertion on SaaS builds; on-prem builds still enforce it.
//
// We read process.env.DEPLOYMENT_MODE directly (not IS_ONPREM imported
// from '@/lib/deployment-mode') because this assertion runs at module
// load and the vi.mock factory in license-runtime-gate.test.ts hoists
// above its `let isSaas` binding — a static IS_ONPREM import via that
// mock crashes the mocked getter with TDZ during module init. The
// process.env path keeps this module dependency-free for the test
// hoist while still being correct at production runtime (vitest
// projects + next.config DefinePlugin both set DEPLOYMENT_MODE).
//
// Build-time pitfall (caught during May 2026 E2E session): webpack's
// DefinePlugin inlines `process.env.NODE_ENV` at compile time, so the
// `NODE_ENV === 'production'` check becomes either `'production' ===
// 'production'` (true, fires unconditionally at runtime — bad: blocks
// local on-prem dry-runs against dev keys) or `'development' ===
// 'production'` (false, dead-stripped — bad: prod build with dev keys
// no longer fail-fast). Two mitigations stacked:
//
//   1. Read NODE_ENV via the read() indirection below — DefinePlugin
//      pattern-matches on the literal `process.env.NODE_ENV` member
//      access, not on a property lookup through a variable. This keeps
//      the check observing the real runtime value of NODE_ENV (so
//      `NODE_ENV=development node server.js` against an on-prem build
//      doesn't trip the assertion).
//
//   2. Explicit operator opt-out: ASTER_ALLOW_DEV_TRUST_BUNDLE=true
//      bypasses the assertion entirely. Required for local integration
//      runs that *must* use NODE_ENV=production (e.g. testing the
//      production-only env-validation paths) without committing real
//      Ed25519 keys to the dev tree.
//
/* eslint-disable deployment-mode/no-direct-macro -- see comment above */
function readEnv(name: string): string | undefined {
  // Indirect lookup defeats webpack DefinePlugin's static replacement,
  // which only matches direct `process.env.NAME` accesses.
  return (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env?.[name];
}
const _trustBundleNodeEnv = readEnv('NODE_ENV');
const _trustBundleAllowDev = readEnv('ASTER_ALLOW_DEV_TRUST_BUNDLE') === 'true';
if (
  process.env.DEPLOYMENT_MODE === 'on-prem' &&
  _trustBundleNodeEnv === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  !_trustBundleAllowDev &&
  ASTER_TRUST_BUNDLE.some((entry) => entry.keyId.startsWith('__dev-'))
) {
  throw new Error(
    '[license-trust-bundle] production runtime contains development placeholder public keys. ' +
      'Set ASTER_ALLOW_DEV_TRUST_BUNDLE=true to bypass (local dry-runs only — NEVER in real prod).',
  );
}
/* eslint-enable deployment-mode/no-direct-macro */

export function findTrustedKey(
  keyId: string,
  purpose: TrustBundleEntryPurpose,
): TrustBundleEntry | null {
  return (
    ASTER_TRUST_BUNDLE.find(
      (entry) => entry.keyId === keyId && entry.purpose === purpose,
    ) ?? null
  );
}

export function listActiveKeys(
  purpose: TrustBundleEntryPurpose,
): readonly TrustBundleEntry[] {
  return ASTER_TRUST_BUNDLE.filter(
    (entry) => entry.purpose === purpose && entry.status === 'active',
  );
}
