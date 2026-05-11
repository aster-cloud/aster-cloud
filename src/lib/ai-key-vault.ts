// BYOK 加密存储辅助
//
// 用 Postgres pgcrypto 列加密；主密钥来自 env AI_KEY_ENCRYPTION_SECRET（Vault 注入）。
// 加密发生在 INSERT/UPDATE 时，解密只在 aster-api 调 LLM 时（in-memory，不入 log）。

import { db, aiKeyBindings } from '@/lib/prisma';
import { eq, and, sql } from 'drizzle-orm';

function encryptionSecret(): string {
  const s = process.env.AI_KEY_ENCRYPTION_SECRET;
  if (!s || s.length < 16) {
    throw new Error('AI_KEY_ENCRYPTION_SECRET 未设置或长度 < 16');
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
}): Promise<void> {
  const secret = encryptionSecret();
  const keyHint = params.apiKey.slice(-4);

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
          "lastErrorAt" = NULL,
          "lastError" = NULL,
          "updatedAt" = NOW()
      WHERE "id" = ${existing.id}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO "AiKeyBinding"
        ("id", "userId", "provider", "encryptedKey", "keyHint", "active", "createdAt", "updatedAt")
      VALUES (
        ${globalThis.crypto.randomUUID()},
        ${params.userId},
        ${params.provider},
        pgp_sym_encrypt(${params.apiKey}::text, ${secret}::text)::text,
        ${keyHint},
        true,
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

/** 停用 BYOK（用户 UI 上的 Disable 按钮） */
export async function deactivateBYOKKey(userId: string, provider: string): Promise<void> {
  await db
    .update(aiKeyBindings)
    .set({ active: false, updatedAt: new Date() })
    .where(and(eq(aiKeyBindings.userId, userId), eq(aiKeyBindings.provider, provider)));
}
