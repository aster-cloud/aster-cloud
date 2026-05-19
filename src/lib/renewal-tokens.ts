// Renewal token mint / verify / consume — SaaS-only.
//
// Design：
//   - 32-byte random → base64url 43-char "raw token"。送邮件 + 拼 URL。
//   - DB 只存 sha256(rawToken)。SaaS DB 泄漏不能反推 URL。
//   - 14 天 TTL：覆盖 renewal-warning 阈值 (30/14/7/1d) 中最远那次（足够
//     给客户一次机会）。
//   - 同 license 在不同 threshold 触发可重复 mint（每次新 token），但
//     consume 是 once（防 replay）。
//   - 不存 plaintext + idempotent unique on (licenseId, threshold) by
//     caller — 这里不做调度，仅 verify 一个 token 是否仍可用。
//
// Hot-gate marker：integration smell test 不依赖 deployment-mode dead
// branch（本模块只用 DB），但本能性地标注以警示 on-prem 不该 import。

/* @deployment-mode-hot-gate
 * reason: SaaS-only renewal portal token store. on-prem 不接 Stripe / 邮件，
 *         不需要触达此模块。整文件应该被 webpack alias=false 等价路径排除，
 *         保留 marker 防止有人误从 admin 页面 import。
 */

import { createHash, randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db, renewalTokens, type RenewalToken } from '@/lib/prisma';

const TOKEN_RAW_BYTES = 32;
const TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface MintedToken {
  /** Raw URL-safe token; only known to caller and recipient. NEVER persisted. */
  raw: string;
  /** sha256(raw); the DB primary key for lookups. */
  hash: string;
  expiresAt: Date;
}

export interface MintInput {
  licenseId: string;
  customer: string;
  /** Echo of payload.deploymentBinding so consume time we can renew without re-reading the old license. */
  oldDeploymentBinding: Record<string, unknown>;
  /** Override TTL (tests). */
  ttlMs?: number;
  /** Override clock (tests). */
  now?: Date;
}

export type VerifyOutcome =
  | { kind: 'valid'; row: RenewalToken }
  | { kind: 'not-found' }
  | { kind: 'expired'; row: RenewalToken }
  | { kind: 'already-consumed'; row: RenewalToken };

function hashToken(raw: string): string {
  return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Mint a new renewal token. Returns the raw token (for the URL/email)
 * + DB row. Caller must ship the raw value via secure channel
 * immediately and discard it — only the hash is queryable afterwards.
 */
export async function mintRenewalToken(input: MintInput): Promise<MintedToken> {
  const now = input.now ?? new Date();
  const ttl = input.ttlMs ?? TOKEN_TTL_MS;
  const raw = randomBytes(TOKEN_RAW_BYTES)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const hash = hashToken(raw);
  const expiresAt = new Date(now.getTime() + ttl);

  await db.insert(renewalTokens).values({
    tokenHash: hash,
    licenseId: input.licenseId,
    customer: input.customer,
    oldDeploymentBinding: input.oldDeploymentBinding,
    createdAt: now,
    expiresAt,
  });

  return { raw, hash, expiresAt };
}

/**
 * Look up a token by raw value (hash-on-the-fly). Returns a typed outcome
 * so callers can show the right portal state without branching on null +
 * date comparison everywhere.
 */
export async function verifyRenewalToken(
  raw: string,
  opts: { now?: Date } = {},
): Promise<VerifyOutcome> {
  // 长度防御：不合法长度直接拒，避免无谓 DB 查询 + timing 泄漏。
  if (!raw || raw.length < 32 || raw.length > 128) return { kind: 'not-found' };
  const hash = hashToken(raw);
  const now = opts.now ?? new Date();

  const row = await db.query.renewalTokens.findFirst({
    where: eq(renewalTokens.tokenHash, hash),
  });
  if (!row) return { kind: 'not-found' };
  if (row.consumedAt) return { kind: 'already-consumed', row };
  if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'expired', row };
  return { kind: 'valid', row };
}

/**
 * Stamp consumedAt with timestamp-or-now atomically. Returns the row on
 * success or null if the token was already consumed concurrently (race).
 * Caller should treat null as the user double-clicked — show a friendly
 * "already in progress" page, don't error out.
 */
export async function markTokenConsumed(
  rawOrHash: string,
  opts: { now?: Date; alreadyHashed?: boolean } = {},
): Promise<RenewalToken | null> {
  const hash = opts.alreadyHashed ? rawOrHash : hashToken(rawOrHash);
  const now = opts.now ?? new Date();
  const result = await db
    .update(renewalTokens)
    .set({ consumedAt: now })
    .where(
      sql`${renewalTokens.tokenHash} = ${hash} AND ${renewalTokens.consumedAt} IS NULL`,
    )
    .returning();
  return result[0] ?? null;
}

/**
 * Stamp emailSentAt — separate from mint to keep mint synchronous +
 * idempotent even if email delivery fails / is queued. Callers can mint
 * + ship to queue + mark sent on queue commit.
 */
export async function markTokenEmailSent(
  hash: string,
  opts: { now?: Date } = {},
): Promise<void> {
  await db
    .update(renewalTokens)
    .set({ emailSentAt: opts.now ?? new Date() })
    .where(eq(renewalTokens.tokenHash, hash));
}

/**
 * Convenience for callers: hash a raw token (used by webhook handler to
 * resolve back to a row when Stripe checkout metadata only carries hash).
 */
export function hashRenewalToken(raw: string): string {
  return hashToken(raw);
}
