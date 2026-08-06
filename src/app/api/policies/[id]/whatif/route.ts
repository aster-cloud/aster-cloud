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
import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { db, policies, executions, executionOutcomes, policyVersions, users } from '@/lib/prisma';
import { and, eq, desc, isNotNull, count } from 'drizzle-orm';
import { estimateWhatIf, type OutcomeSample } from '@/lib/analytics/whatif-estimate';
import { createPolicyApiClient } from '@/services/policy/policy-api';
import { parseApprovalFromResult } from '@/services/policy/cnl-executor';
import { STATUS_REPLAYABLE } from '@/lib/policy-execution-log';
import { errorEnvelope } from '@/lib/api/error-envelope';

export const dynamic = 'force-dynamic';

/**
 * 单次最多重跑的条数（ADR 0033 §4）。
 *
 * <p>远低于漏斗的 2000：重跑比读库贵得多。S0 实测单条 1.35ms（单条规则），
 * 但真实策略有多模块/大 context，成本更高，故保留保守上限。
 */
const MAX_REPLAY = 200;

/** 重跑并发度——既不让 aster-api 被打爆，也不让 200 条串行等太久。 */
const REPLAY_CONCURRENCY = 8;

/** 给数字的双判门槛（ADR 0033 §3.4）。 */
const MIN_REPLAYED = 30;
const MIN_COVERAGE = 0.2;

/** DB enum 是小写 approved/denied/indeterminate/error，不是 estimateWhatIf 默认的大写。 */
const APPROVE_DECISIONS = ['approved'] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({ code: 'UNAUTHORIZED', message: '未登录', status: 401 });
  }
  const userId = session.user.id;
  const { id } = await params;
  const url = new URL(request.url);

  // ★租户隔离：归属校验必须带 userId（本仓多次出现同类跨租户读）。
  const owned = await db
    .select({ id: policies.id })
    .from(policies)
    .where(and(eq(policies.id, id), eq(policies.userId, userId)))
    .limit(1);
  if (owned.length === 0) {
    return errorEnvelope({ code: 'NOT_FOUND', message: '策略不存在', status: 404 });
  }

  // ★显式授权开关：本端点读明文业务输入，未开启一律拒绝。
  //   返回 403 而不是空结果——静默降级会让用户以为功能坏了。
  const [caller] = await db
    .select({ replayRetentionEnabled: users.replayRetentionEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!caller?.replayRetentionEnabled) {
    return errorEnvelope({
      code: 'REPLAY_RETENTION_DISABLED',
      message:
        'What-if 估算需要读取历史执行的输入数据，请先在设置中开启「保留回放明文」（replayRetentionEnabled）。未开启时平台不保存明文输入，无法重跑。',
      status: 403,
    });
  }

  const baseVersion = parseVersion(url.searchParams.get('baseVersion'));
  const targetVersion = parseVersion(url.searchParams.get('targetVersion'));
  if (baseVersion === null || targetVersion === null) {
    return errorEnvelope({
      code: 'INVALID_VERSION',
      message: 'baseVersion 与 targetVersion 必须是 1..2147483647 的整数',
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

  // 目标版本的源码——重跑的另一半。带 policyId 过滤（版本号在策略内唯一）。
  const [target] = await db
    .select({ source: policyVersions.source, content: policyVersions.content, aliasSet: policyVersions.aliasSet })
    .from(policyVersions)
    .where(and(eq(policyVersions.policyId, id), eq(policyVersions.version, targetVersion)))
    .limit(1);
  const targetSource = target?.source ?? target?.content ?? null;
  if (!targetSource) {
    return errorEnvelope({
      code: 'VERSION_NOT_FOUND',
      message: `目标版本 v${targetVersion} 不存在或无源码`,
      status: 404,
    });
  }

  const baseWhere = and(
    eq(executions.policyId, id),
    eq(executions.userId, userId),
    eq(executions.policyVersion, baseVersion),
    isNotNull(executions.decision),
  );

  // ★覆盖率的分母必须是**全量**，不能被 LIMIT 截断——否则
  //   「5000 条里只有 40 条可重跑」会被算成「200 条里 40 条」，比例虚高 6 倍。
  const [{ value: totalCount }] = await db
    .select({ value: count() })
    .from(executions)
    .where(baseWhere);

  // 基线：baseVersion 下跑过的执行 + 事后回传的结局。
  // 左连接：没有 outcome 的执行也进样本。
  //
  // ★REPLAYABLE 过滤必须下推到 SQL，不能查回来再 filter：
  //   LIMIT 取的是最近 N 条，若近期执行恰好多为 NON_REPLAYABLE，
  //   可重跑条数会塌到接近 0——即便库里有几千条可重跑的历史执行。
  //   （真库 E2E 实测：250 条里 35 条可重跑，按旧写法 replayable=0）
  const baseRows = await db
    .select({
      executionId: executions.id,
      decision: executions.decision,
      input: executions.input,
      locale: executions.locale,
      functionName: executions.functionName,
      aliasSetJson: executions.aliasSetJson,
      replayabilityStatus: executions.replayabilityStatus,
      outcome: executionOutcomes.outcome,
      value: executionOutcomes.value,
    })
    .from(executions)
    .leftJoin(executionOutcomes, eq(executionOutcomes.executionId, executions.id))
    .where(and(baseWhere, eq(executions.replayabilityStatus, STATUS_REPLAYABLE)))
    .orderBy(desc(executions.createdAt))
    .limit(MAX_REPLAY);

  // sampleSize = 符合筛选条件的**全部**执行；replayableRows 是其中可重跑的样本。
  const sampleSize = totalCount;
  const replayableRows = baseRows.filter((r) => r.input != null);

  // ★重跑：只跑 REPLAYABLE，失败计入 replayFailed 而**不是**当成「决策未变」——
  //   后者会系统性低估 changed。
  const apiClient = createPolicyApiClient(userId, userId);
  const newDecisions = new Map<string, string>();
  let replayFailed = 0;

  for (let i = 0; i < replayableRows.length; i += REPLAY_CONCURRENCY) {
    const batch = replayableRows.slice(i, i + REPLAY_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((r) =>
        apiClient.evaluateSource(targetSource, r.input as Record<string, unknown>, {
          locale: r.locale ?? undefined,
          functionName: r.functionName ?? undefined,
          aliasSet: (target?.aliasSet ? safeParseAliasSet(target.aliasSet) : null) ?? undefined,
        }),
      ),
    );
    settled.forEach((res, k) => {
      if (res.status !== 'fulfilled') {
        replayFailed++;
        return;
      }
      // ★promise resolve 不等于重跑成功：evaluateSource 可能返回 error 非空
      //   （目标版本编译失败、函数名对不上、运行时异常）。那是失败，不是决策——
      //   当成决策会把它算进 changed，系统性歪曲结论。
      if (res.value?.error) {
        replayFailed++;
        return;
      }
      // ★decision 模式：裸字符串永不 approve（见 cnl-executor 的 mode 语义）
      const parsed = parseApprovalFromResult(res.value?.result, 'decision');
      const decision = parsed.indeterminate
        ? 'indeterminate'
        : parsed.approved
          ? 'approved'
          : 'denied';
      newDecisions.set(batch[k].executionId, decision);
    });
  }

  const replayed = newDecisions.size;
  const coverage = sampleSize > 0 ? replayed / sampleSize : 0;

  // ★双判门槛（ADR 0033 §3.4）：条数与代表性比例都得够。
  //   两个 reason 分开——「再攒些数据」与「大多不可回放」是完全不同的动作。
  const counts = {
    sampleSize,
    replayable: replayableRows.length,
    replayed,
    replayFailed,
    coverage,
    truncated: baseRows.length >= MAX_REPLAY,
    limit: MAX_REPLAY,
  };
  if (replayed < MIN_REPLAYED) {
    return NextResponse.json({
      policyId: id,
      baseVersion,
      targetVersion,
      comparable: false,
      reason: 'INSUFFICIENT_REPLAYED',
      message: `可重跑的执行只有 ${replayed} 条（需要 ${MIN_REPLAYED} 条），样本太少无法估算。`,
      ...counts,
    });
  }
  if (coverage < MIN_COVERAGE) {
    return NextResponse.json({
      policyId: id,
      baseVersion,
      targetVersion,
      comparable: false,
      reason: 'INSUFFICIENT_COVERAGE',
      message: `仅 ${replayed}/${sampleSize} 条执行可重跑（${Math.round(coverage * 100)}%，需要 ${Math.round(MIN_COVERAGE * 100)}%），结论不足以外推到全部执行。`,
      ...counts,
    });
  }

  // ★估算样本 = 可重跑的那批（baseRows 现已在 SQL 层过滤为 REPLAYABLE）。
  //   不该把不可重跑的执行放进分母：它们没有对照决策，
  //   estimateWhatIf 会把「查不到新决策」当成「决策未变」，系统性低估 changed。
  //   全量条数由 sampleSize（独立 count 查询）单独回报，用于覆盖率口径。
  const samples: OutcomeSample[] = baseRows.map((r) => ({
    executionId: r.executionId,
    decision: r.decision ?? '',
    outcome: r.outcome ?? null,
    // numeric 列以字符串返回以免丢精度；估算要做算术，此处转 number。
    value: r.value === null || r.value === undefined ? null : Number(r.value),
  }));

  const estimate = estimateWhatIf(samples, newDecisions, {
    positiveOutcomes: parseList(url.searchParams.get('positiveOutcomes')),
    negativeOutcomes: parseList(url.searchParams.get('negativeOutcomes')),
    approveDecisions: APPROVE_DECISIONS,
  });

  return NextResponse.json({
    policyId: id,
    baseVersion,
    targetVersion,
    comparable: true,
    ...counts,
    ...estimate,
  });
}

/** 解析版本号；缺失/非正整数/超 PG int4 上限一律 null（由调用方转 400）。 */
function parseVersion(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null;
  if (!/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
}

/** 版本冻结的 aliasSet 是 text 列存的 JSON；解析失败按「无别名」处理，不炸整个请求。 */
function safeParseAliasSet(raw: string): Record<string, string[]> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : null;
  } catch {
    return null;
  }
}

/** 逗号分隔列表；空/缺省返回空数组。 */
function parseList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
