/**
 * GDPR Article 15 — 用户数据可访问权
 *
 * 返回当前用户的所有 AI 审计记录（解密原文）。
 * - 仅本人可调取（NextAuth session）
 * - 加密原文实时解密；safetyFlags / redactedPrompt 直返
 * - 不返回他人数据；不暴露管理元字段
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/prisma';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;
  const secret = process.env.AI_AUDIT_ENCRYPTION_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Audit secret not configured' }, { status: 500 });
  }

  // 解密 prompt / completion；非加密字段原样返回
  const result = await db.execute(sql`
    SELECT
      id,
      "createdAt",
      "callKind",
      model,
      "promptTokens",
      "completionTokens",
      "costCents",
      "usedByok",
      status,
      "redactedPrompt",
      "safetyFlags",
      CASE WHEN "encryptedPrompt" IS NOT NULL
        THEN pgp_sym_decrypt("encryptedPrompt"::bytea, ${secret}::text)
        ELSE NULL
      END AS prompt,
      CASE WHEN "encryptedCompletion" IS NOT NULL
        THEN pgp_sym_decrypt("encryptedCompletion"::bytea, ${secret}::text)
        ELSE NULL
      END AS completion
    FROM "AiUsageRecord"
    WHERE "userId" = ${userId}
    ORDER BY "createdAt" DESC
  `);

  const records = result as unknown as Array<Record<string, unknown>>;

  return NextResponse.json({
    user_id: userId,
    exported_at: new Date().toISOString(),
    record_count: records.length,
    records,
  });
}
