// BYOK 加密存储辅助
//
// 用 Postgres pgcrypto 列加密；主密钥来自 env AI_KEY_ENCRYPTION_SECRET（Vault 注入）。
// 加密发生在 INSERT/UPDATE 时，解密只在 aster-api 调 LLM 时（in-memory，不入 log）。

import { db, aiKeyBindings } from '@/lib/prisma';
import { eq, and, sql } from 'drizzle-orm';

function encryptionSecret(): string {
  const s = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!s || s.length < 16) {
    // Distinct error code so the BFF can tell deploy-config-missing
    // from runtime crypto failure. The route catches both as 503,
    // but the Worker log captures the .code for triage.
    const err = new Error(
      'AI_KEY_ENCRYPTION_SECRET is not set on the Worker (or < 16 chars). ' +
        'Set it via `wrangler secret put AI_KEY_ENCRYPTION_SECRET`.',
    );
    (err as Error & { code?: string }).code = 'ENCRYPTION_SECRET_MISSING';
    throw err;
  }
  return s;
}

/**
 * 保存或更新用户的 BYOK key
 * 后 4 位明文存入 keyHint；完整 key 用 pgp_sym_encrypt 加密
 */
export async function saveBYOKKey(params: {
  userId: string;
  provider: 'openai' | 'anthropic' | 'vertex';
  apiKey: string;
  /** 自定义 provider API base URL（可选）。null/undefined = 用内置默认。 */
  providerUrl?: string | null;
  /** BYOK 月度 token 上限（可选）。null/undefined = 无限。 */
  tokenQuota?: number | null;
  /** 失效日期（可选）。null/undefined = 永不过期。 */
  expiresAt?: Date | null;
}): Promise<void> {
  const secret = encryptionSecret();
  const keyHint = params.apiKey.slice(-4);
  // 显式 null 化 undefined，让 SQL 把「未提供」写成 NULL（覆盖旧值 → 用户清空即恢复默认）。
  const providerUrl = params.providerUrl ?? null;
  const tokenQuota = params.tokenQuota ?? null;
  const expiresAt = params.expiresAt ? params.expiresAt.toISOString() : null;

  const existing = await db.query.aiKeyBindings.findFirst({
    where: and(
      eq(aiKeyBindings.userId, params.userId),
      eq(aiKeyBindings.provider, params.provider)
    ),
  });

  if (existing) {
    await db.execute(sql`
      UPDATE "AiKeyBinding"
      SET "encryptedKey" = pgp_sym_encrypt(${params.apiKey}::text, ${secret}::text)::text,
          "keyHint" = ${keyHint},
          "active" = true,
          "providerUrl" = ${providerUrl},
          "tokenQuota" = ${tokenQuota},
          "expiresAt" = ${expiresAt}::timestamp,
          "lastErrorAt" = NULL,
          "lastError" = NULL,
          "updatedAt" = NOW()
      WHERE "id" = ${existing.id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO "AiKeyBinding"
        ("id", "userId", "provider", "encryptedKey", "keyHint", "active",
         "providerUrl", "tokenQuota", "expiresAt", "createdAt", "updatedAt")
      VALUES (
        ${globalThis.crypto.randomUUID()},
        ${params.userId},
        ${params.provider},
        pgp_sym_encrypt(${params.apiKey}::text, ${secret}::text)::text,
        ${keyHint},
        true,
        ${providerUrl},
        ${tokenQuota},
        ${expiresAt}::timestamp,
        NOW(),
        NOW()
      )
    `);
  }
}

/** 解密用户的 BYOK key（仅供 LLM 调用使用） */
export async function getDecryptedBYOKKey(userId: string, provider: string): Promise<string | null> {
  const secret = encryptionSecret();
  const result = await db.execute(sql`
    SELECT pgp_sym_decrypt("encryptedKey"::bytea, ${secret}::text) AS key
    FROM "AiKeyBinding"
    WHERE "userId" = ${userId}
      AND "provider" = ${provider}
      AND "active" = true
    LIMIT 1
  `);
  const rows = result as unknown as Array<{ key: string | null }>;
  return rows[0]?.key ?? null;
}

/**
 * 解密 BYOK key 并**同时**返回 quota/expiresAt/providerUrl（推理层 enforcement 用）。
 * 与 getDecryptedBYOKKey 分开，避免改动其现有调用点的返回契约。
 */
export interface DecryptedBYOK {
  key: string;
  providerUrl: string | null;
  tokenQuota: number | null;
  expiresAt: Date | null;
}
export async function getBYOKForInference(
  userId: string,
  provider: string,
): Promise<DecryptedBYOK | null> {
  const secret = encryptionSecret();
  const result = await db.execute(sql`
    SELECT pgp_sym_decrypt("encryptedKey"::bytea, ${secret}::text) AS key,
           "providerUrl" AS provider_url,
           "tokenQuota"  AS token_quota,
           "expiresAt"   AS expires_at
    FROM "AiKeyBinding"
    WHERE "userId" = ${userId}
      AND "provider" = ${provider}
      AND "active" = true
    LIMIT 1
  `);
  const rows = result as unknown as Array<{
    key: string | null;
    provider_url: string | null;
    token_quota: number | null;
    expires_at: string | Date | null;
  }>;
  const row = rows[0];
  if (!row?.key) return null;
  return {
    key: row.key,
    providerUrl: row.provider_url ?? null,
    tokenQuota: row.token_quota ?? null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
  };
}

/** 停用 BYOK（临时禁用而不删除；保留供内部使用/未来 UI）。 */
export async function deactivateBYOKKey(userId: string, provider: string): Promise<void> {
  await db
    .update(aiKeyBindings)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(aiKeyBindings.userId, userId), eq(aiKeyBindings.provider, provider)));
}

/**
 * 硬删除 BYOK key（用户 UI「撤销/删除」按钮）——物理删除整行,含加密 key + 历史。
 * 撤销即删除（用户诉求 + 隐私：key 不再留存）。
 */
export async function deleteBYOKKey(userId: string, provider: string): Promise<void> {
  await db
    .delete(aiKeyBindings)
    .where(and(eq(aiKeyBindings.userId, userId), eq(aiKeyBindings.provider, provider)));
}
