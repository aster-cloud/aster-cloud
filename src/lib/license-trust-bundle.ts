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

export const ASTER_TRUST_BUNDLE: readonly TrustBundleEntry[] = [
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

assertUniqueKeyIds(ASTER_TRUST_BUNDLE);
assertNoLowOrderPubKeys(ASTER_TRUST_BUNDLE);

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
/* eslint-disable deployment-mode/no-direct-macro -- see comment above */
if (
  process.env.DEPLOYMENT_MODE === 'on-prem' &&
  process.env.NODE_ENV === 'production' &&
  process.env.NEXT_PHASE !== 'phase-production-build' &&
  ASTER_TRUST_BUNDLE.some((entry) => entry.keyId.startsWith('__dev-'))
) {
  throw new Error(
    '[license-trust-bundle] production runtime contains development placeholder public keys',
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
