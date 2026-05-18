// License revocation fetch + cache state machine（on-prem 端）。
//
// 设计要点：
//   - revocation doc 是公开 signed JSON；客户端 *本地* canonicalize 后用嵌入的
//     revocation public key 验签，不信任服务器返回的字节顺序
//   - revocation signing key 与 license signing key 完全分离（purpose='revocation'）
//   - fetch path 永不 throw；所有失败都返回 typed FetchOutcome
//   - DB cache 是单行表 id='current'，保存本部署自己的 license revocation 状态
//   - Air-gapped SKU 的逻辑在 caller 层（refreshLicenseRevocationCache 提早返回）
//
// 关键不变量：
//   - 版本单调递增：received.version 必须严格 > cached.revocationVersion，否则
//     拒绝（防止 replay / rollback 攻击）；用 BigInt 比较避免 number 精度丢失
//   - validUntil 必须 > now；否则视为 stale publication 并报错给运维
//   - HTTPS-only：fetch 前显式校验 url protocol（payload 校验是第一道防线）

import { eq, sql } from 'drizzle-orm';
import {
  ASTER_TRUST_BUNDLE,
  type TrustBundleEntry,
} from '@/lib/license-trust-bundle';
import { db, licenseCache, type Database } from '@/lib/prisma';
import type { ConnectivityStatus, LicensePayloadV2 } from '@/lib/license';
import { recordLicenseRefreshOutcome } from '@/lib/license-metrics';

// 兼容 tx (db.transaction 回调参数) 与顶层 db 的最小执行器接口。
// drizzle 的 PgTransaction 与 PostgresJsDatabase 都满足 { execute(...) } 形态。
type RevocationDbExecutor = Pick<Database, 'execute'>;

// postgres.js 在 `prepare: false`（Hyperdrive 兼容模式）下不会自动把 Date
// 序列化成 ISO 字符串，会触发 Bind 阶段 TypeError。所有传入 raw `sql\`\`` 的
// timestamp 参数必须先经过此转换。drizzle 的 update/insert builder 走的是
// 不同的 codec 路径，不受影响——仅 raw sql 需要。
function toIsoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export type RevocationReason =
  | 'non-payment'
  | 'security'
  | 'renewal-superseded'
  | 'contract-terminated'
  | 'fraud';

export interface SignedRevocationDoc {
  schemaVersion: 1;
  version: number;
  publishedAt: string;
  validUntil: string;
  revoked: ReadonlyArray<{
    licenseId: string;
    revokedAt: string;
    reason: RevocationReason;
  }>;
  signature: string;
}

export interface RevocationError {
  url: string;
  httpStatus?: number;
  parseError?: string;
  signatureError?: string;
  networkError?: string;
}

export interface RevocationCacheRow {
  licenseId: string;
  licenseKeyHash?: string;
  payloadJson?: LicensePayloadV2 | Record<string, unknown>;
  signingKeyId?: string;
  verifiedAt?: Date;
  revocationVersion?: bigint | number;
  revocationPublishedAt?: Date;
  revocationFetchedAt?: Date;
  lastSuccessfulRevocationCheckAt?: Date;
  lastRevocationError?: RevocationError | null;
  isRevoked: boolean;
  revokedAt?: Date;
  revokedReason?: string;
}

export interface FetchOptions {
  url: string;
  etag?: string | null;
  cachedVersion?: bigint | number | null;
  trustBundle?: readonly TrustBundleEntry[];
  now?: Date;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

export type FetchOutcome =
  | { kind: 'updated'; doc: SignedRevocationDoc; etag: string | null }
  | { kind: 'not-modified'; etag: string | null }
  | { kind: 'http-error'; status: number; body?: string }
  | { kind: 'network-error'; message: string }
  | { kind: 'parse-error'; message: string }
  | { kind: 'signature-error'; message: string }
  | {
      kind: 'version-rollback';
      cachedVersion: bigint | number;
      receivedVersion: number;
    };

export type RefreshOutcome =
  | {
      outcome: 'updated' | 'not-modified';
      version?: bigint | number;
      isRevoked: boolean;
      cache: RevocationCacheRow;
    }
  | {
      outcome:
        | 'missing-cache'
        | 'missing-revocation-url'
        | 'air-gapped'
        | 'http-error'
        | 'network-error'
        | 'parse-error'
        | 'signature-error'
        | 'version-rollback'
        | 'concurrent-refresh-in-progress';
      version?: bigint | number;
      isRevoked?: boolean;
      error?: RevocationError;
      cache?: RevocationCacheRow;
    };

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_GRACE_WINDOW_MS = 7 * DAY_MS;
const DEFAULT_STALENESS_WINDOW_MS = 25 * 60 * 60 * 1000;
// 限制 revocation 文档大小防内存攻击（codex 审查 Major-3）
const MAX_REVOCATION_DOC_BYTES = 8 * 1024 * 1024; // 8 MiB
const MAX_REVOKED_ENTRIES = 200_000;

// PG advisory lock name → 经 SHA-256 派生 64-bit key 用于 pg_try_advisory_xact_lock。
// 单一全局 lock：所有 license-revocation refresh 互斥。
const REVOCATION_LOCK_NAME = 'license-revocation-refresh';

class ConcurrentRefreshInProgressError extends Error {
  constructor() {
    super('concurrent-refresh-in-progress');
  }
}

// ===== 编码 helpers =====

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
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

function base64urlToBytes(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) {
    throw new Error('invalid-base64url');
  }
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

function isIsoDate(s: string): boolean {
  const ms = Date.parse(s);
  return !Number.isNaN(ms) && new Date(ms).toISOString() === s;
}

// ===== 文档校验 =====

function isRevocationReason(value: unknown): value is RevocationReason {
  return (
    value === 'non-payment' ||
    value === 'security' ||
    value === 'renewal-superseded' ||
    value === 'contract-terminated' ||
    value === 'fraud'
  );
}

function isSignedRevocationDoc(value: unknown): value is SignedRevocationDoc {
  if (!value || typeof value !== 'object') return false;
  const o = value as Record<string, unknown>;
  if (o.schemaVersion !== 1) return false;
  if (
    typeof o.version !== 'number' ||
    !Number.isSafeInteger(o.version) ||
    o.version <= 0
  ) {
    return false;
  }
  if (typeof o.publishedAt !== 'string' || !isIsoDate(o.publishedAt)) return false;
  if (typeof o.validUntil !== 'string' || !isIsoDate(o.validUntil)) return false;
  if (typeof o.signature !== 'string' || !/^[A-Za-z0-9_-]+$/.test(o.signature)) {
    return false;
  }
  if (!Array.isArray(o.revoked)) return false;
  return o.revoked.every((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const r = entry as Record<string, unknown>;
    return (
      typeof r.licenseId === 'string' &&
      r.licenseId.length > 0 &&
      typeof r.revokedAt === 'string' &&
      isIsoDate(r.revokedAt) &&
      isRevocationReason(r.reason)
    );
  });
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = sortKeys((value as Record<string, unknown>)[key]);
  }
  return out;
}

/**
 * Canonicalize 签名前的 message：移除 signature 字段 + 递归按 key 字母序序列化。
 * 必须本地 canonicalize；不信任服务器返回的字段顺序。
 */
export function canonicalizeRevocationDoc(
  doc: SignedRevocationDoc,
): Uint8Array {
  // 用解构丢弃 signature；保留所有其他字段
  const { signature: _signature, ...unsignedDoc } = doc;
  void _signature;
  return new TextEncoder().encode(JSON.stringify(sortKeys(unsignedDoc)));
}

async function verifyRevocationSignature(
  doc: SignedRevocationDoc,
  bundle: readonly TrustBundleEntry[],
): Promise<boolean> {
  const message = canonicalizeRevocationDoc(doc);
  const signature = base64urlToBytes(doc.signature);
  // 接受 active + verify-only（rotation 期内旧 key 仍能验旧 doc）；只拒绝 retired
  const keys = bundle.filter(
    (entry) => entry.purpose === 'revocation' && entry.status !== 'retired',
  );
  for (const entry of keys) {
    try {
      const key = await crypto.subtle.importKey(
        'raw',
        toArrayBuffer(base64ToBytes(entry.pubKey)),
        { name: 'Ed25519' },
        false,
        ['verify'],
      );
      const ok = await crypto.subtle.verify(
        'Ed25519',
        key,
        toArrayBuffer(signature),
        toArrayBuffer(message),
      );
      if (ok) return true;
    } catch {
      // 单个 key 损坏不让整个 bundle throw；继续尝试其他 revocation key
    }
  }
  return false;
}

function compareVersion(
  received: number,
  cached: bigint | number | null | undefined,
): boolean {
  if (cached === null || cached === undefined) return true;
  return BigInt(received) > BigInt(cached);
}

// ===== Fetch / 状态机 =====

export async function fetchRevocationDoc(
  opts: FetchOptions,
): Promise<FetchOutcome> {
  const now = opts.now ?? new Date();
  let url: URL;
  try {
    url = new URL(opts.url);
  } catch {
    return { kind: 'network-error', message: 'invalid-url' };
  }
  if (url.protocol !== 'https:') {
    return { kind: 'network-error', message: 'revocation-url-must-be-https' };
  }

  const controller = new AbortController();
  // codex 审查 Major-1：timeout 必须覆盖整个请求生命周期（含 body 读取）
  // 不在 try/finally 提前 clearTimeout — 让 controller.abort() 也能终止慢的 body 流
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await (opts.fetchFn ?? fetch)(url.toString(), {
        method: 'GET',
        headers: opts.etag ? { 'If-None-Match': opts.etag } : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      return {
        kind: 'network-error',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const etag = response.headers.get('etag');
    if (response.status === 304) {
      // 304 必须由我们主动发起的 If-None-Match 触发，且需要已有 cached version
      if (
        !opts.etag ||
        opts.cachedVersion === null ||
        opts.cachedVersion === undefined
      ) {
        return {
          kind: 'parse-error',
          message: 'unexpected-304-without-etag-or-cache',
        };
      }
      return { kind: 'not-modified', etag };
    }
    if (!response.ok) {
      let body: string | undefined;
      try {
        body = await response.text();
      } catch {
        body = undefined;
      }
      return { kind: 'http-error', status: response.status, body };
    }

    // 防 Content-Length 攻击
    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader) {
      const declared = Number(contentLengthHeader);
      if (Number.isFinite(declared) && declared > MAX_REVOCATION_DOC_BYTES) {
        return {
          kind: 'parse-error',
          message: `revocation-doc-too-large: ${declared} bytes`,
        };
      }
    }

    let text: string;
    try {
      // controller.abort() 仍处于 active timeout 内，慢 body 也会被截断
      text = await response.text();
    } catch (error) {
      return {
        kind: 'network-error',
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (text.length > MAX_REVOCATION_DOC_BYTES) {
      return {
        kind: 'parse-error',
        message: `revocation-doc-too-large: ${text.length} bytes`,
      };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return {
        kind: 'parse-error',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    if (!isSignedRevocationDoc(parsed)) {
      return { kind: 'parse-error', message: 'revocation-doc-shape-invalid' };
    }

    if (parsed.revoked.length > MAX_REVOKED_ENTRIES) {
      return {
        kind: 'parse-error',
        message: `revocation-doc-too-many-entries: ${parsed.revoked.length}`,
      };
    }

    if (Date.parse(parsed.validUntil) < now.getTime()) {
      return { kind: 'parse-error', message: 'revocation-doc-expired' };
    }

    if (!compareVersion(parsed.version, opts.cachedVersion)) {
      return {
        kind: 'version-rollback',
        cachedVersion: opts.cachedVersion ?? 0,
        receivedVersion: parsed.version,
      };
    }

    try {
      const ok = await verifyRevocationSignature(
        parsed,
        opts.trustBundle ?? ASTER_TRUST_BUNDLE,
      );
      if (!ok) return { kind: 'signature-error', message: 'signature-mismatch' };
    } catch (error) {
      return {
        kind: 'signature-error',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    return { kind: 'updated', doc: parsed, etag };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Grace period 状态机（pure，无 I/O）。
 *
 * 状态转换：
 *   - cache 不存在 → not-applicable（首次启动，尚无 cache 行）
 *   - 有 fetch 记录但从未成功 → error（无 grace 计时器基线）
 *   - 最近一次成功在 stalenessWindowMs（默认 25h）内 → fresh
 *   - 成功 25h-7d 之间 → grace（容忍正常网络故障）
 *   - 成功超 7d → grace-expired（触发 UI 强告警 + 未来版本 read-only 降级）
 */
export function evaluateGracePeriod(
  cache: RevocationCacheRow | null,
  now: Date,
  opts: { graceWindowMs?: number; stalenessWindowMs?: number } = {},
): ConnectivityStatus {
  if (!cache) return 'not-applicable';
  const graceWindowMs = opts.graceWindowMs ?? DEFAULT_GRACE_WINDOW_MS;
  const stalenessWindowMs = opts.stalenessWindowMs ?? DEFAULT_STALENESS_WINDOW_MS;

  if (!cache.lastSuccessfulRevocationCheckAt && !cache.revocationFetchedAt) {
    return 'not-applicable';
  }
  if (!cache.lastSuccessfulRevocationCheckAt) {
    return 'error';
  }

  const ageMs = now.getTime() - cache.lastSuccessfulRevocationCheckAt.getTime();
  if (ageMs <= stalenessWindowMs) return 'fresh';
  if (ageMs <= graceWindowMs) return 'grace';
  return 'grace-expired';
}

export function isLicenseRevoked(
  cache: RevocationCacheRow | null,
  licenseId: string,
): boolean {
  return cache?.licenseId === licenseId && cache.isRevoked;
}

// ===== DB layer =====

function dbRowToCacheRow(
  row: typeof licenseCache.$inferSelect | undefined,
): RevocationCacheRow | null {
  if (!row) return null;
  return {
    licenseId: row.licenseId,
    licenseKeyHash: row.licenseKeyHash,
    payloadJson: row.payloadJson as LicensePayloadV2 | Record<string, unknown>,
    signingKeyId: row.signingKeyId,
    verifiedAt: row.verifiedAt,
    revocationVersion: row.revocationVersion ?? undefined,
    revocationPublishedAt: row.revocationPublishedAt ?? undefined,
    revocationFetchedAt: row.revocationFetchedAt ?? undefined,
    lastSuccessfulRevocationCheckAt:
      row.lastSuccessfulRevocationCheckAt ?? undefined,
    lastRevocationError:
      (row.lastRevocationError as RevocationError | null) ?? undefined,
    isRevoked: row.isRevoked,
    revokedAt: row.revokedAt ?? undefined,
    revokedReason: row.revokedReason ?? undefined,
  };
}

export async function loadCurrentCache(): Promise<RevocationCacheRow | null> {
  const row = await db.query.licenseCache.findFirst({
    where: eq(licenseCache.id, 'current'),
  });
  return dbRowToCacheRow(row);
}

/**
 * 全量 upsert（用于首次写入或 verifier 重新校验后的整行刷新）。
 *
 * 注意：覆盖整行，会无条件覆盖 revocation 字段。仅用于已显式持锁或 verifier
 * 阶段（refreshLicenseRevocationCache 内部用更细粒度的 applySuccessOutcome /
 * applyErrorOutcome）。
 */
export async function upsertCache(row: RevocationCacheRow): Promise<void> {
  const now = new Date();
  await db
    .insert(licenseCache)
    .values({
      id: 'current',
      licenseId: row.licenseId,
      licenseKeyHash: row.licenseKeyHash ?? '',
      payloadJson: row.payloadJson ?? {},
      signingKeyId: row.signingKeyId ?? '',
      verifiedAt: row.verifiedAt ?? now,
      revocationVersion:
        row.revocationVersion === undefined ? null : BigInt(row.revocationVersion),
      revocationPublishedAt: row.revocationPublishedAt ?? null,
      revocationFetchedAt: row.revocationFetchedAt ?? null,
      lastSuccessfulRevocationCheckAt:
        row.lastSuccessfulRevocationCheckAt ?? null,
      lastRevocationError: row.lastRevocationError ?? null,
      isRevoked: row.isRevoked,
      revokedAt: row.revokedAt ?? null,
      revokedReason: row.revokedReason ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: licenseCache.id,
      set: {
        revocationVersion:
          row.revocationVersion === undefined
            ? null
            : BigInt(row.revocationVersion),
        revocationPublishedAt: row.revocationPublishedAt ?? null,
        revocationFetchedAt: row.revocationFetchedAt ?? null,
        lastSuccessfulRevocationCheckAt:
          row.lastSuccessfulRevocationCheckAt ?? null,
        lastRevocationError: row.lastRevocationError ?? null,
        isRevoked: row.isRevoked,
        revokedAt: row.revokedAt ?? null,
        revokedReason: row.revokedReason ?? null,
        updatedAt: now,
      },
    });
}

/**
 * 成功路径专用 upsert：只在 received version > cached version 时才更新
 * revocation 字段（DB 层 WHERE 防 rollback；codex 审查 Critical-1）。
 *
 * 返回真正写入了几行（0 = 因并发更新 + WHERE 拒绝而 skip，调用方可静默忽略）。
 */
export async function applySuccessOutcome(
  licenseId: string,
  receivedVersion: bigint,
  publishedAt: Date,
  fetchedAt: Date,
  isRevoked: boolean,
  revokedAt: Date | undefined,
  revokedReason: string | undefined,
  executor: RevocationDbExecutor = db,
): Promise<number> {
  // 仅当 cached version 为 NULL 或严格小于 received 时才更新；
  // 同时清空 lastRevocationError，更新 attempt + success 时间戳
  const publishedAtIso = publishedAt.toISOString();
  const fetchedAtIso = fetchedAt.toISOString();
  const revokedAtIso = toIsoOrNull(revokedAt);
  const result = await executor.execute<{ id: string }>(sql`
    UPDATE "LicenseCache"
    SET
      "revocation_version" = ${receivedVersion},
      "revocation_published_at" = ${publishedAtIso},
      "revocation_fetched_at" = ${fetchedAtIso},
      "last_successful_revocation_check_at" = ${fetchedAtIso},
      "last_revocation_error" = NULL,
      "is_revoked" = ${isRevoked},
      "revoked_at" = ${revokedAtIso},
      "revoked_reason" = ${revokedReason ?? null},
      "updated_at" = ${fetchedAtIso}
    WHERE
      "id" = 'current'
      AND "license_id" = ${licenseId}
      AND ("revocation_version" IS NULL OR "revocation_version" < ${receivedVersion})
    RETURNING "id"
  `);
  // drizzle execute 返回的行计数因驱动而异；用 RETURNING 长度作为权威信号
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows ?? [];
  return rows.length;
}

/**
 * 304 Not-Modified 路径：仅更新成功 timestamp 与 attempt timestamp，
 * **不**改 version / isRevoked 等字段。
 */
export async function applyNotModified(
  licenseId: string,
  fetchedAt: Date,
  executor: RevocationDbExecutor = db,
): Promise<void> {
  const fetchedAtIso = fetchedAt.toISOString();
  await executor.execute(sql`
    UPDATE "LicenseCache"
    SET
      "revocation_fetched_at" = ${fetchedAtIso},
      "last_successful_revocation_check_at" = ${fetchedAtIso},
      "last_revocation_error" = NULL,
      "updated_at" = ${fetchedAtIso}
    WHERE "id" = 'current' AND "license_id" = ${licenseId}
  `);
}

/**
 * 失败路径：仅更新 attempt timestamp + error 字段，**不**清空 success timestamp
 * （保留 grace 计时器锚点）也**不**动 version / isRevoked。
 */
export async function applyErrorOutcome(
  licenseId: string,
  fetchedAt: Date,
  error: RevocationError | null,
  executor: RevocationDbExecutor = db,
): Promise<void> {
  const fetchedAtIso = fetchedAt.toISOString();
  await executor.execute(sql`
    UPDATE "LicenseCache"
    SET
      "revocation_fetched_at" = ${fetchedAtIso},
      "last_revocation_error" = ${error ? JSON.stringify(error) : null}::jsonb,
      "updated_at" = ${fetchedAtIso}
    WHERE "id" = 'current' AND "license_id" = ${licenseId}
  `);
}

function getPayload(cache: RevocationCacheRow): LicensePayloadV2 | null {
  const payload = cache.payloadJson;
  if (!payload || typeof payload !== 'object') return null;
  // 二次校验关键字段（codex 审查 Minor-6：防止 DB 行损坏 / tampering）
  // 只做我们 refresh 路径必需的最小校验，避免与 verifyLicenseKey 重复
  const p = payload as Record<string, unknown>;
  if (p.sku !== 'standard' && p.sku !== 'air-gapped') return null;
  if (p.sku === 'standard' && typeof p.revocationCheckUrl !== 'string') return null;
  if (typeof p.licenseId !== 'string') return null;
  return payload as LicensePayloadV2;
}

function errorFromOutcome(
  url: string,
  outcome: FetchOutcome,
): RevocationError | null {
  if (outcome.kind === 'updated' || outcome.kind === 'not-modified') return null;
  if (outcome.kind === 'http-error') return { url, httpStatus: outcome.status };
  if (outcome.kind === 'network-error')
    return { url, networkError: outcome.message };
  if (outcome.kind === 'parse-error')
    return { url, parseError: outcome.message };
  if (outcome.kind === 'signature-error')
    return { url, signatureError: outcome.message };
  return {
    url,
    parseError: `version rollback: cached=${outcome.cachedVersion.toString()} received=${outcome.receivedVersion}`,
  };
}

// ===== Refresh orchestrator（cron + manual 复用） =====

/**
 * 计算 advisory lock key —— SHA-256(LOCK_NAME) 的前 8 字节作为 int8。
 *
 * 关键设计（codex 审查 Major-5：refresh 并发锁）：
 *   - 用 pg_try_advisory_xact_lock：非阻塞，拿不到立刻返回 false
 *   - lock 自动随 transaction 结束释放，进程崩溃时由 PG 连接关闭自动释放
 *     —— 无需手动 unlock，无死锁风险
 *   - 全局单 lock：所有 refresh（cron + manual）互斥
 */
async function revocationLockKey(): Promise<bigint> {
  const bytes = new TextEncoder().encode(REVOCATION_LOCK_NAME);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  // 取前 8 字节 big-endian → 有符号 int8（Postgres 期望 bigint）
  return new DataView(digest).getBigInt64(0, false);
}

/**
 * 在 PG advisory lock 保护下执行 fn。
 * 拿不到 lock 立即 throw ConcurrentRefreshInProgressError；caller 应翻译成
 * RefreshOutcome.outcome = 'concurrent-refresh-in-progress'。
 */
export async function withRevocationLock<T>(
  fn: (executor: RevocationDbExecutor) => Promise<T>,
): Promise<T> {
  const key = await revocationLockKey();
  return db.transaction(async (tx) => {
    const result = await tx.execute<{ locked: boolean }>(sql`
      SELECT pg_try_advisory_xact_lock(${key}) AS "locked"
    `);
    const rows = Array.isArray(result)
      ? result
      : (result as { rows?: Array<{ locked: boolean }> }).rows ?? [];
    if (!rows[0]?.locked) {
      throw new ConcurrentRefreshInProgressError();
    }
    // 必须把 tx 透传给 fn —— 否则 fn 内部用顶层 db 时会争抢 pool 中
    // 已被 tx 占用的唯一连接，造成死锁（max=1 时必现，max>1 时偶发）。
    return fn(tx);
  });
}

export async function refreshLicenseRevocationCache(
  opts: {
    now?: Date;
    fetchFn?: typeof fetch;
    trustBundle?: readonly TrustBundleEntry[];
  } = {},
): Promise<RefreshOutcome> {
  // 所有出口路径都通过 finish() 自动 record metrics（codex F follow-up）
  const finish = (result: RefreshOutcome): RefreshOutcome => {
    recordLicenseRefreshOutcome(result.outcome);
    return result;
  };

  const now = opts.now ?? new Date();
  const cache = await loadCurrentCache();
  if (!cache) return finish({ outcome: 'missing-cache' });

  const payload = getPayload(cache);
  if (payload?.sku === 'air-gapped') {
    return finish({ outcome: 'air-gapped', cache, isRevoked: cache.isRevoked });
  }

  // 用 advisory lock 包裹真正的 fetch + DB 写入路径。air-gapped + missing-cache
  // 不需要锁（纯读 + 立即返回）。
  try {
    return finish(
      await withRevocationLock((tx) => runRefreshLocked(cache, payload, opts, now, tx)),
    );
  } catch (error) {
    if (error instanceof ConcurrentRefreshInProgressError) {
      return finish({
        outcome: 'concurrent-refresh-in-progress',
        cache,
        isRevoked: cache.isRevoked,
        version: cache.revocationVersion,
      });
    }
    throw error;
  }
}

/**
 * Lock 保护下的 fetch + upsert 实际逻辑。
 * 参数显式传入避免 closure 捕获 outer scope（便于单测）。
 */
async function runRefreshLocked(
  cache: RevocationCacheRow,
  payload: LicensePayloadV2 | null,
  opts: { now?: Date; fetchFn?: typeof fetch; trustBundle?: readonly TrustBundleEntry[] },
  now: Date,
  executor: RevocationDbExecutor,
): Promise<RefreshOutcome> {
  const url = payload?.revocationCheckUrl;
  if (!url) {
    const error: RevocationError = { url: '', parseError: 'missing-revocation-url' };
    // codex 审查 Major-1：用 applyErrorOutcome 不动 version/revoked 字段
    await applyErrorOutcome(cache.licenseId, now, error, executor);
    return {
      outcome: 'missing-revocation-url',
      cache,
      error,
      isRevoked: cache.isRevoked,
    };
  }

  const outcome = await fetchRevocationDoc({
    url,
    now,
    cachedVersion: cache.revocationVersion,
    fetchFn: opts.fetchFn,
    trustBundle: opts.trustBundle,
  });

  if (outcome.kind === 'updated') {
    const revoked = outcome.doc.revoked.find(
      (r) => r.licenseId === cache.licenseId,
    );
    const newVersion = BigInt(outcome.doc.version);
    // codex 审查 Critical-1：DB 层 WHERE 比较版本，并发 refresh 不会 rollback
    const rowsUpdated = await applySuccessOutcome(
      cache.licenseId,
      newVersion,
      new Date(outcome.doc.publishedAt),
      now,
      Boolean(revoked),
      revoked ? new Date(revoked.revokedAt) : undefined,
      revoked?.reason,
      executor,
    );
    if (rowsUpdated === 0) {
      // 并发 refresh 已写入更新版本；当前数据视为 not-modified
      return {
        outcome: 'not-modified',
        version: cache.revocationVersion,
        isRevoked: cache.isRevoked,
        cache,
      };
    }
    const next: RevocationCacheRow = {
      ...cache,
      revocationVersion: newVersion,
      revocationPublishedAt: new Date(outcome.doc.publishedAt),
      revocationFetchedAt: now,
      lastSuccessfulRevocationCheckAt: now,
      lastRevocationError: null,
      isRevoked: Boolean(revoked),
      revokedAt: revoked ? new Date(revoked.revokedAt) : undefined,
      revokedReason: revoked?.reason,
    };
    return {
      outcome: 'updated',
      version: next.revocationVersion,
      isRevoked: next.isRevoked,
      cache: next,
    };
  }

  if (outcome.kind === 'not-modified') {
    // codex 审查 Critical-1：只更新 timestamps，不动 version/revoked 字段
    await applyNotModified(cache.licenseId, now, executor);
    const next: RevocationCacheRow = {
      ...cache,
      revocationFetchedAt: now,
      lastSuccessfulRevocationCheckAt: now,
      lastRevocationError: null,
    };
    return {
      outcome: 'not-modified',
      version: next.revocationVersion,
      isRevoked: next.isRevoked,
      cache: next,
    };
  }

  const error = errorFromOutcome(url, outcome);
  // codex 审查 Critical-1：失败路径只动 attempt + error 字段
  await applyErrorOutcome(cache.licenseId, now, error, executor);
  const next: RevocationCacheRow = {
    ...cache,
    revocationFetchedAt: now,
    lastRevocationError: error,
  };
  return {
    outcome: outcome.kind,
    version: cache.revocationVersion,
    isRevoked: cache.isRevoked,
    error: error ?? undefined,
    cache: next,
  };
}
