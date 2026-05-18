// Enterprise license key parser.
//
// License key 格式（v1）：`aster-ent-<yyyy>-<base64url(json-payload)>`
//
// payload schema：
//   {
//     "customer":   "Acme Corp",
//     "issuedAt":   "2026-01-15T00:00:00.000Z",  // ISO date
//     "expiresAt":  "2027-01-15T00:00:00.000Z",  // ISO date
//     "seatLimit":  500,                          // int, -1 = unlimited
//     "tier":       "enterprise",                 // 'enterprise' | 'enterprise-plus'
//     "features":   ["sso", "audit-export", "custom-domain"]
//   }
//
// 设计要点：
//   - 纯解析，不校验签名：本 PR 暂不引入 RSA / Ed25519 ceremony；签名校验
//     留给后续 PR（license-signing）。现在的 key 是 base64(json)，明文可读，
//     操作员手动签发的 trust。生产 GA 必须升级为签名版本。
//   - 三类失败：MISSING（env 未设）/ MALFORMED（格式错）/ EXPIRED（日期过）
//   - 解析结果用 discriminated union，UI 按 status 字段分支
//   - 不依赖外部包；用 Web atob + JSON.parse + Date

export type LicenseStatus =
  | 'missing'      // LICENSE_KEY 未设置
  | 'malformed'    // 格式错（前缀错 / base64 失败 / JSON 失败 / 字段缺）
  | 'expired'     // 当前日期 >= expiresAt
  | 'active';      // 一切正常

export interface LicensePayload {
  /** 客户名（display only）。 */
  customer: string;
  /** 签发 ISO 日期。 */
  issuedAt: string;
  /** 失效 ISO 日期。 */
  expiresAt: string;
  /**
   * 席位上限。-1 = unlimited。
   * Seat enforcement 由 admin 控制台和 createUser 路径协同执行
   * （on-prem PR 范围外的后续工作）。
   */
  seatLimit: number;
  /** 许可证档次。影响 feature gating。 */
  tier: 'enterprise' | 'enterprise-plus';
  /** 启用的可选功能标志。每个对应一个 boolean capability。 */
  features: ReadonlyArray<string>;
}

/**
 * License 验证状态。
 *
 * - 'unsigned'：当前实现仅做格式解析，未做密码学签名校验。
 *   `status='active'` 只代表"payload 格式合法且未过期"，**不**代表 Aster 签发。
 *   feature gating / seat enforcement 不应依赖此状态值；必须等
 *   signature-verification PR 之后才能用于授权决策。
 * - 'verified'（未实现）：未来 PR 引入 Ed25519 / RSA 签名校验后启用。
 *
 * UI 必须在 active 面板显著提示当前是 unsigned 状态，避免训练操作员
 * 误信任伪造 key。
 */
export type LicenseVerification = 'unsigned' | 'verified';

export interface LicenseResult {
  status: LicenseStatus;
  /** 当前实现固定为 'unsigned'。详见 LicenseVerification 注释。 */
  verification: LicenseVerification;
  /** 原始 key 前缀（脱敏，仅显示前 8 个字符 + …）— 用于日志和 UI 提示。 */
  keyPreview: string;
  /** parsed payload，仅在 status='active' 或 'expired' 时存在。 */
  payload?: LicensePayload;
  /** 解析失败时的人类可读原因（i18n 友好的简短 reason code）。 */
  reasonCode?:
    | 'env-missing'
    | 'prefix-mismatch'
    | 'base64-decode-failed'
    | 'json-parse-failed'
    | 'payload-shape-invalid';
  /** 计算后的剩余天数（active=正数, expired=负数, 其它=undefined）。 */
  daysRemaining?: number;
}

const KEY_PREFIX_RE = /^aster-ent-(\d{4})-([A-Za-z0-9_-]+)$/;

function maskKey(key: string | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 8)}…`;
}

function base64urlDecode(s: string): string {
  // base64url → base64
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  // 补齐 padding
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);

  // 优先用 Node Buffer（vitest / Node runtime）—— 一步到位正确解 UTF-8
  // bytes，避免 atob 返回 binary string 时非 ASCII 字符乱码（codex M4）。
  // 仅在没有 Buffer 的 Edge / Workers runtime 才回退 atob + TextDecoder。
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(padded, 'base64').toString('utf8');
  }
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder('utf-8').decode(bytes);
}

function isValidPayload(p: unknown): p is LicensePayload {
  if (!p || typeof p !== 'object') return false;
  const o = p as Record<string, unknown>;
  if (typeof o.customer !== 'string' || o.customer.length === 0) return false;
  if (typeof o.issuedAt !== 'string') return false;
  if (typeof o.expiresAt !== 'string') return false;
  // seatLimit 必须是整数；要么 -1（unlimited）要么 > 0；0 / 负数 / 小数都拒绝
  if (typeof o.seatLimit !== 'number' || !Number.isInteger(o.seatLimit)) return false;
  if (o.seatLimit !== -1 && o.seatLimit <= 0) return false;
  if (o.tier !== 'enterprise' && o.tier !== 'enterprise-plus') return false;
  if (!Array.isArray(o.features)) return false;
  if (!o.features.every((f) => typeof f === 'string')) return false;
  // ISO 日期可解析
  if (Number.isNaN(Date.parse(o.issuedAt))) return false;
  if (Number.isNaN(Date.parse(o.expiresAt))) return false;
  return true;
}

/**
 * 解析 LICENSE_KEY env。
 *
 * @param rawKey 原始 env 值（undefined / 空字符串 = missing）
 * @param now    可注入的当前时间（测试用），默认 new Date()
 */
export function parseLicenseKey(
  rawKey: string | undefined,
  now: Date = new Date(),
): LicenseResult {
  if (!rawKey || rawKey.trim() === '') {
    return {
      status: 'missing',
      verification: 'unsigned',
      keyPreview: '',
      reasonCode: 'env-missing',
    };
  }

  const trimmed = rawKey.trim();
  const keyPreview = maskKey(trimmed);

  const m = KEY_PREFIX_RE.exec(trimmed);
  if (!m) {
    return {
      status: 'malformed',
      verification: 'unsigned',
      keyPreview,
      reasonCode: 'prefix-mismatch',
    };
  }

  const payloadB64 = m[2];
  let decoded: string;
  try {
    decoded = base64urlDecode(payloadB64);
  } catch {
    return {
      status: 'malformed',
      verification: 'unsigned',
      keyPreview,
      reasonCode: 'base64-decode-failed',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch {
    return {
      status: 'malformed',
      verification: 'unsigned',
      keyPreview,
      reasonCode: 'json-parse-failed',
    };
  }

  if (!isValidPayload(parsed)) {
    return {
      status: 'malformed',
      verification: 'unsigned',
      keyPreview,
      reasonCode: 'payload-shape-invalid',
    };
  }

  const payload = parsed;
  const expiresAtMs = Date.parse(payload.expiresAt);
  const daysRemaining = Math.floor(
    (expiresAtMs - now.getTime()) / (24 * 60 * 60 * 1000),
  );

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
 * Convenience：检查某 feature flag 是否在 license 中启用。
 * 非 active license → 始终 false。
 */
export function hasLicenseFeature(
  result: LicenseResult,
  feature: string,
): boolean {
  if (result.status !== 'active') return false;
  return result.payload?.features.includes(feature) ?? false;
}
