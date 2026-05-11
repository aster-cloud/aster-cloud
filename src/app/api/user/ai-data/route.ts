/**
 * GDPR Article 17 — 用户被遗忘权
 *
 * DELETE：立即抹除当前用户所有 AI 审计原文（encryptedPrompt / encryptedCompletion）
 *   - 保留：聚合统计字段（promptTokens, costCents, status）— 计费/合规/异常检测仍需
 *   - 同步删除：redactedPrompt（用户主动要求遗忘，应一并清空脱敏文本）
 *   - 不删除整行：promptHash 留作反盗刷指纹；status 留作账单凭证
 */
import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { db } from '@/lib/prisma';
import { sql } from 'drizzle-orm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  const result = await db.execute(sql`
    UPDATE "AiUsageRecord"
    SET "encryptedPrompt" = NULL,
        "encryptedCompletion" = NULL,
        "redactedPrompt" = NULL
    WHERE "userId" = ${userId}
      AND ("encryptedPrompt" IS NOT NULL
        OR "encryptedCompletion" IS NOT NULL
        OR "redactedPrompt" IS NOT NULL)
    RETURNING id
  `);

  const affected = (result as unknown as Array<unknown>).length;

  console.warn(`[gdpr-erasure] user ${userId} requested data deletion, ${affected} records cleared`);

  return NextResponse.json({
    user_id: userId,
    deleted_at: new Date().toISOString(),
    records_cleared: affected,
  });
}
