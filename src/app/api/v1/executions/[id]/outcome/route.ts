/**
 * 业务结果回传（Phase 3）：POST /api/v1/executions/:id/outcome
 *
 * <p>平台只记录「批准/拒绝」，不知道该决策事后是否成交/坏账。本端点让客户在
 * 决策落地后回传真实结果——这是「改策略会少赚多少钱」这类问题的**唯一**数据来源。
 *
 * <p>幂等：同一 executionId 重复回传会**覆盖**而非堆叠（结局只有一个，
 * 更正是正常需求）。覆盖靠 reportedAt 留痕。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, executions, executionOutcomes } from '@/lib/prisma';
import { and, eq } from 'drizzle-orm';
import { errorEnvelope } from '@/lib/api/error-envelope';

export const dynamic = 'force-dynamic';

/** outcome 词汇由租户自定义，但仍需限长——防止把它当自由文本字段塞大对象。 */
const MAX_OUTCOME_LEN = 64;
const MAX_NOTE_LEN = 1024;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({ code: 'UNAUTHORIZED', message: '未登录', status: 401 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorEnvelope({ code: 'INVALID_JSON', message: '请求体不是合法 JSON', status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errorEnvelope({ code: 'INVALID_JSON', message: '请求体必须是 JSON 对象', status: 400 });
  }
  const b = body as Record<string, unknown>;

  const outcome = typeof b.outcome === 'string' ? b.outcome.trim() : '';
  if (!outcome) {
    return errorEnvelope({ code: 'INVALID_OUTCOME', message: 'outcome 不能为空', status: 400 });
  }
  if (outcome.length > MAX_OUTCOME_LEN) {
    return errorEnvelope({
      code: 'INVALID_OUTCOME',
      message: `outcome 超过 ${MAX_OUTCOME_LEN} 字符`,
      status: 400,
    });
  }

  // ★value 必须是有限数：NaN / Infinity 进了 numeric 列会让后续聚合全线崩坏，
  //   且 JSON 里 Infinity 会被序列化成 null 造成静默丢数。宁可 400 也不收。
  let value: string | null = null;
  if (b.value !== undefined && b.value !== null) {
    const n = typeof b.value === 'number' ? b.value : Number(b.value);
    if (!Number.isFinite(n)) {
      return errorEnvelope({ code: 'INVALID_VALUE', message: 'value 必须是有限数值', status: 400 });
    }
    value = String(n);
  }

  let occurredAt: Date | null = null;
  if (b.occurredAt !== undefined && b.occurredAt !== null) {
    const d = new Date(String(b.occurredAt));
    if (Number.isNaN(d.getTime())) {
      return errorEnvelope({ code: 'INVALID_DATE', message: 'occurredAt 不是合法时间', status: 400 });
    }
    occurredAt = d;
  }

  const note = typeof b.note === 'string' ? b.note.slice(0, MAX_NOTE_LEN) : null;

  // ★租户隔离：必须同时按 executionId 和 userId 查。只按 id 查会让任何登录用户
  //   往别人的执行上写结果，污染他人的业务统计（本仓多次出现同类跨租户写）。
  const rows = await db
    .select({ id: executions.id, policyId: executions.policyId })
    .from(executions)
    .where(and(eq(executions.id, id), eq(executions.userId, session.user.id)))
    .limit(1);
  if (rows.length === 0) {
    // 404 而非 403：不泄露「该执行存在但不属于你」
    return errorEnvelope({ code: 'NOT_FOUND', message: '执行记录不存在', status: 404 });
  }

  await db
    .insert(executionOutcomes)
    .values({
      id: globalThis.crypto.randomUUID(),
      executionId: id,
      userId: session.user.id,
      policyId: rows[0].policyId,
      outcome,
      value,
      occurredAt,
      note,
    })
    // 幂等覆盖：同一执行只保留最新结局
    .onConflictDoUpdate({
      target: executionOutcomes.executionId,
      set: { outcome, value, occurredAt, note, reportedAt: new Date() },
    });

  return NextResponse.json({ ok: true, executionId: id, outcome });
}
