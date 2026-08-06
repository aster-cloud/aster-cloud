/**
 * What-if 影响估算（Phase 4）：GET /api/policies/:id/whatif
 *
 * <p>回答「把这条策略换成另一个版本，业务指标会怎样」：取历史执行的**输入**，
 * 用目标版本的源码现场重跑，得到对照决策，再乘以历史 outcome 的分布。
 *
 * <p><b>模型见 ADR 0033</b>。要点：
 * <ul>
 *   <li>关联键不是 executionId（一行只属于一个版本，跨版本 id 交集恒空），
 *       而是「同一条 input 在两个版本下分别判成什么」</li>
 *   <li>对照决策**按需重求值**，只在内存中存在，不落库（S0 实测单条 1.35ms）</li>
 *   <li>只重跑 {@code replayabilityStatus = REPLAYABLE} 的执行</li>
 * </ul>
 *
 * <p><b>★授权：必须显式开启 {@code replayRetentionEnabled}。</b>
 * 本端点会读取历史执行的**明文业务输入**——这是它与 Phase 1 漏斗
 * （零 PII）的本质区别。未开启时返回 403 并说明如何开启，
 * 而不是静默降级成空结果。
 *
 * <p><b>★口径</b>：`replayed` 才是估算的真实分母。绝对条数与代表性比例
 * 双判（ADR 0033 §3.4），任一不满足就不给数字。
 */
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies } from '@/lib/prisma';
import { and, eq } from 'drizzle-orm';
import { errorEnvelope } from '@/lib/api/error-envelope';

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({ code: 'UNAUTHORIZED', message: '未登录', status: 401 });
  }
  const { id } = await params;

  // ★仍先做归属校验再拒答：否则本端点会退化成「策略是否存在」的探针——
  //   任意登录用户拿别人的 policyId 来打，就能从 409/404 差异推断存在性。
  const owned = await db
    .select({ id: policies.id })
    .from(policies)
    .where(and(eq(policies.id, id), eq(policies.userId, session.user.id)))
    .limit(1);
  if (owned.length === 0) {
    // 404 而非 403：不泄露「该 id 存在但不属于你」
    return errorEnvelope({ code: 'NOT_FOUND', message: '策略不存在', status: 404 });
  }

  return errorEnvelope({
    code: 'REPLAY_REQUIRED',
    message:
      '动态 What-if 估算已暂停：按需重跑得到的成功子集带选择偏差，' +
      '不足以代表总体影响。等待独立的 replay run 模型落地后重新开放。',
    status: 409,
  });
}
