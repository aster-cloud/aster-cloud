/**
 * What-if 影响估算（Phase 4）：GET /api/policies/:id/whatif
 *
 * <p>回答「把这条策略改成另一个版本，业务指标会怎样」——把历史执行的决策变化
 * 乘以历史 outcome 的分布，折算成正面率与金额的估计变化。
 *
 * <p><b>★这是估算不是预测。</b>{@link estimateWhatIf} 的 assumption 与两档
 * confidence 必须随数字一起呈现，UI 不得单独展示金额。详见该模块头注释。
 *
 * <p><b>与 Phase 1 漏斗的区别</b>：漏斗只用零 PII 的骨架，对全部租户可用；
 * 本端点需要客户主动回传的 {@code ExecutionOutcome}，没有回传就没有结论——
 * 这时返回 `insufficient` 而不是编一个数字。
 *
 * <p><b>决策口径</b>：对比的是**同一批历史执行**在两个策略版本下的决策。
 * 当前实现取 `baseVersion` 与 `targetVersion` 两个版本各自的历史执行记录，
 * 按 executionId 对齐——即「同一次请求在新版本下会被判成什么」只能来自
 * 真实跑过的记录，不做重放推演（重放是 M2 的独立工程，见 ADR 0030）。
 */
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, executions, executionOutcomes } from '@/lib/prisma';
import { and, eq, desc, isNotNull } from 'drizzle-orm';
import { estimateWhatIf, type OutcomeSample } from '@/lib/analytics/whatif-estimate';
import { errorEnvelope } from '@/lib/api/error-envelope';

export const dynamic = 'force-dynamic';

/** 单次查询最多扫描的执行条数——与漏斗同口径，防止大租户把 Worker 打爆。 */
const MAX_SAMPLE = 2000;
const DEFAULT_SAMPLE = 500;

/**
 * ★决策取值必须与 DB enum 对齐。
 *
 * `executionDecisionEnum` 是**小写**的 approved/denied/indeterminate/error，
 * 而 {@link estimateWhatIf} 的默认值是大写 'APPROVED'。直接用默认值会让所有
 * 样本都被判成「未放行」，基线恒为空，端点静默返回一个毫无意义的
 * insufficient——不报错、不告警，最难查的那种坏。故此处显式传入。
 */
const APPROVE_DECISIONS = ['approved'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({ code: 'UNAUTHORIZED', message: '未登录', status: 401 });
  }
  const { id } = await params;
  const url = new URL(request.url);

  // ★租户隔离：必须同时按 policyId 和 userId 过滤（与漏斗同理，见该 route 注释）。
  const owned = await db
    .select({ id: policies.id })
    .from(policies)
    .where(and(eq(policies.id, id), eq(policies.userId, session.user.id)))
    .limit(1);
  if (owned.length === 0) {
    return errorEnvelope({ code: 'NOT_FOUND', message: '策略不存在', status: 404 });
  }

  // ★不能直接 Number(searchParams.get(...))：参数缺失时 get() 返回 null，
  // 而 Number(null) === 0（不是 NaN），会静默变成"版本 0"去查一个不存在的版本，
  // 返回 200 + 空结论。必须先判存在，再判整数、判正数。
  const baseVersion = parseVersion(url.searchParams.get('baseVersion'));
  const targetVersion = parseVersion(url.searchParams.get('targetVersion'));
  if (baseVersion === null || targetVersion === null) {
    return errorEnvelope({
      code: 'INVALID_VERSION',
      message: 'baseVersion 与 targetVersion 必须是正整数',
      status: 400,
    });
  }
  if (baseVersion === targetVersion) {
    return errorEnvelope({
      code: 'INVALID_VERSION',
      message: '两个版本相同，无可比较的决策变化',
      status: 400,
    });
  }

  const limit = Math.min(
    Math.max(Number(url.searchParams.get('limit')) || DEFAULT_SAMPLE, 1),
    MAX_SAMPLE,
  );

  // 基线：baseVersion 下跑过的执行 + 它们事后回传的结局。
  // ★左连接而非内连接：没有 outcome 的执行也要进样本——它们决定 sampleSize，
  // 是「有多少执行还没回传结局」这个覆盖率问题的分母。
  const baseRows = await db
    .select({
      executionId: executions.id,
      decision: executions.decision,
      outcome: executionOutcomes.outcome,
      value: executionOutcomes.value,
    })
    .from(executions)
    .leftJoin(executionOutcomes, eq(executionOutcomes.executionId, executions.id))
    .where(
      and(
        eq(executions.policyId, id),
        eq(executions.userId, session.user.id),
        eq(executions.policyVersion, baseVersion),
        isNotNull(executions.decision),
      ),
    )
    .orderBy(desc(executions.createdAt))
    .limit(limit);

  // 目标版本下的决策，按 executionId 对齐。
  const targetRows = await db
    .select({ executionId: executions.id, decision: executions.decision })
    .from(executions)
    .where(
      and(
        eq(executions.policyId, id),
        eq(executions.userId, session.user.id),
        eq(executions.policyVersion, targetVersion),
        isNotNull(executions.decision),
      ),
    )
    .orderBy(desc(executions.createdAt))
    .limit(limit);

  const newDecisions = new Map<string, string>();
  for (const r of targetRows) {
    if (r.decision) newDecisions.set(r.executionId, r.decision);
  }

  const samples: OutcomeSample[] = baseRows.map((r) => ({
    executionId: r.executionId,
    decision: r.decision ?? '',
    outcome: r.outcome ?? null,
    // value 是 numeric 列，driver 以字符串返回以免丢精度；
    // 估算要做算术，此处转 number。非法值交给 estimateWhatIf 的 isFinite 过滤。
    value: r.value === null || r.value === undefined ? null : Number(r.value),
  }));

  const estimate = estimateWhatIf(samples, newDecisions, {
    positiveOutcomes: parseList(url.searchParams.get('positiveOutcomes')),
    negativeOutcomes: parseList(url.searchParams.get('negativeOutcomes')),
    approveDecisions: APPROVE_DECISIONS,
  });

  // ★可比性检查：一次执行只在**一个**版本下跑过，故两个版本的 executionId
  // 天然不重叠——除非上游做过真回放（M2，尚未落地）把同一批输入在新版本上重跑。
  //
  // 不做这个检查的话，newDecisions 永远命中不了任何样本，估算会输出
  // changed=0 / newlyRejected=0 / delta=0 —— 也就是自信地宣称「改这个版本
  // 毫无影响」。那比报错糟得多：它看起来是个结论。
  const alignedCount = samples.filter((s) => newDecisions.has(s.executionId)).length;
  if (alignedCount === 0) {
    return NextResponse.json({
      policyId: id,
      baseVersion,
      targetVersion,
      comparedAgainst: newDecisions.size,
      sampleSize: samples.length,
      // 明确拒绝给数字，而不是给一串 0
      comparable: false,
      reason: 'NO_ALIGNED_EXECUTIONS',
      message:
        '两个版本没有可对齐的执行记录：同一次执行只在一个版本下跑过，无法直接比较。' +
        '需要对同一批输入在目标版本上重放后才能估算（回放能力尚未上线）。',
      limit,
    });
  }

  return NextResponse.json({
    policyId: id,
    baseVersion,
    targetVersion,
    comparable: true,
    // 目标版本样本数单独回报：它远小于基线时，changed 会被系统性低估
    // （没跑过新版本的执行无从比较），UI 需据此提示而不是让用户以为覆盖了全部。
    comparedAgainst: newDecisions.size,
    // 真正参与比较的条数——comparedAgainst 只是目标版本的总量，
    // 两者差距大说明对齐率低，结论的代表性有限。
    alignedCount,
    ...estimate,
    limit,
  });
}

/** 解析版本号；缺失/非数字/非正整数一律返回 null（由调用方转 400）。 */
function parseVersion(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** 逗号分隔列表；空/缺省返回空数组（此时正面率恒为 0，caveats 会说明）。 */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
