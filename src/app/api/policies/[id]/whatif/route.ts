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

/**
 * 整批重跑的时间预算。S0 实测单条 1.35ms（简单规则），200 条约 0.3s；
 * 真实策略更重，故留足余量但必须有上界——没有 deadline 时一批慢重跑会把
 * 请求拖死，用户看到的是转圈而不是「样本不够」（第八轮 P0-6）。
 */
const REPLAY_BUDGET_MS = 20_000;

/** 给数字的双判门槛（ADR 0033 §3.4）。 */
const MIN_REPLAYED = 30;
const MIN_COVERAGE = 0.2;

/** DB enum 是小写 approved/denied/indeterminate/error，不是 estimateWhatIf 默认的大写。 */
const APPROVE_DECISIONS = ['approved'] as const;

/**
 * outcome 词汇的平台默认值。
 *
 * <p>outcome 由租户自定义（见 `docs/api/outcome-ingestion.md`），平台不做枚举限制。
 * 但调用方没指定时**不能**退化成空集合——那会让正面率恒为 0，产出一个
 * 看起来正常的错数字。这里给一组最常见词汇兜底，并在 caveats 里标注
 * 「用的是默认词汇」，让用户知道该配自己的。
 */
const DEFAULT_POSITIVE_OUTCOMES = ['converted', 'repaid', 'settled', 'approved_ok'] as const;
const DEFAULT_NEGATIVE_OUTCOMES = ['defaulted', 'refunded', 'charged_off', 'fraud'] as const;

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

  // ★显式授权开关：本端点读**明文业务输入**，未开启一律拒绝。
  //   返回 403 而不是空结果——静默降级会让用户以为功能坏了。
  //
  //   ⚠️ 语义澄清（第八轮 P0-8 指出我此前的说法有误）：
  //   `Execution.input` 是**无条件写入**的（见 execute route），
  //   `replayRetentionEnabled` 并不控制「是否保存明文」。它在本端点的含义是
  //   **「是否授权把这些已存在的明文用于重跑分析」**——一个使用授权，不是存储开关。
  //   原先的 403 文案写「未开启时平台不保存明文输入」是错的，已改。
  //
  //   仍复用它而不新建开关：它是仓内唯一表达「用户对明文回放的显式许可」的字段，
  //   新建第二个会造成两个真相源。但**语义需要扩展**（ADR 0033 §7 待办）。
  const [caller] = await db
    .select({ replayRetentionEnabled: users.replayRetentionEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!caller?.replayRetentionEnabled) {
    return errorEnvelope({
      code: 'REPLAY_RETENTION_DISABLED',
      message:
        'What-if 估算需要读取历史执行的明文输入数据。请先开启账户设置中的「回放明文授权」（replayRetentionEnabled）——它是对「允许用这些输入做重跑分析」的显式授权。',
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
  // ★关于 vocabulary（第八轮 P0-7）：`PolicyVersion.vocabularySnapshotIds` 存的是
  //   **快照引用**（`{snapshotId, domain, locale}[]`），不是词汇内容本身。
  //   核实两条生产 execute 路径后确认：它们同样只把这个引用存进
  //   `Execution.vocabSnapshotRef` 供审计，**从不**向执行端传 vocabulary 内容。
  //   故重跑与真实执行在这一点上已经等价——单独给 What-if 加一条解析链路
  //   反而会让模拟与真实执行走不同的词汇解析，那才是真的语义漂移。
  //   若将来生产路径开始传 vocabulary，这里必须同步（已在 ADR 0033 §7 记为待办）。
  const [target] = await db
    .select({
      source: policyVersions.source,
      content: policyVersions.content,
      aliasSet: policyVersions.aliasSet,
    })
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

  // ★两个全量计数，都不能被 LIMIT 截断：
  //   · totalCount    —— 该版本下的全部执行，用于告诉用户「样本占多少」
  //   · replayableTotal —— 其中**可重跑**的全部条数，才是覆盖率的分母
  //
  //   分母用 totalCount 是错的：replayed 上限 200，而 totalCount 可能几万，
  //   20% 的门槛在大策略上**结构上永远达不到**（第八轮 P0-9）。
  //   覆盖率要回答的是「可重跑的那批里，我们跑了多少」，不是「占全部执行多少」。
  const [{ value: totalCount }] = await db
    .select({ value: count() })
    .from(executions)
    .where(baseWhere);
  const [{ value: replayableTotal }] = await db
    .select({ value: count() })
    .from(executions)
    .where(and(baseWhere, eq(executions.replayabilityStatus, STATUS_REPLAYABLE)));

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

  // replayableRows：本次实际要重跑的样本（SQL 已过滤 REPLAYABLE，这里再排掉无 input 的）。
  // 全量口径走 totalCount / replayableTotal 两个独立 count，见 counts 定义。
  const replayableRows = baseRows.filter((r) => r.input != null);

  // ★重跑：只跑 REPLAYABLE，失败计入 replayFailed 而**不是**当成「决策未变」——
  //   后者会系统性低估 changed。
  const apiClient = createPolicyApiClient(userId, userId);
  const newDecisions = new Map<string, string>();
  let replayFailed = 0;
  let deadlineHit = false;

  // ★整体预算：单条快不代表整批快。没有 deadline 时，一批慢重跑会把请求拖死，
  //   用户看到的是浏览器转圈而不是「样本不够」。超预算即停止并如实回报已跑条数。
  const deadline = Date.now() + REPLAY_BUDGET_MS;
  const targetAliasSet = target?.aliasSet ? safeParseAliasSet(target.aliasSet) : null;

  for (let i = 0; i < replayableRows.length; i += REPLAY_CONCURRENCY) {
    if (Date.now() > deadline) {
      deadlineHit = true;
      break;
    }
    const batch = replayableRows.slice(i, i + REPLAY_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((r) =>
        // ★simulate=true：这是模拟不是真实执行，不计配额、不写指标/审计
        //   （第八轮 P0-1：否则查一次估算就扣掉上百次配额并污染经营 KPI）
        apiClient.evaluateSource(targetSource, r.input as Record<string, unknown>, {
          locale: r.locale ?? undefined,
          functionName: r.functionName ?? undefined,
          aliasSet: targetAliasSet ?? undefined,
          simulate: true,
        }),
      ),
    );
    settled.forEach((res, k) => {
      if (res.status !== 'fulfilled') {
        replayFailed++;
        return;
      }
      // ★promise resolve 不等于重跑成功：evaluateSource 可能返回 error 非空
      //   （目标版本编译失败、函数名对不上、运行时异常）。那是失败，不是决策。
      if (res.value?.error) {
        replayFailed++;
        return;
      }
      // ★★result 为 null/undefined 同样是失败，不是「拒绝」。
      //   Java 侧允许 result=null 仍构造 success 响应；parseApprovalFromResult 在
      //   decision 模式下会把它归进「非 approved」，于是一次**没得到结论的重跑**
      //   被伪造成一条 denied，直接算进 newlyRejected（第八轮 P0-5）。
      //   宁可少一条样本，也不能凭空造一个决策。
      const raw = res.value?.result;
      if (raw === null || raw === undefined) {
        replayFailed++;
        return;
      }
      // ★decision 模式：裸字符串永不 approve（见 cnl-executor 的 mode 语义）
      const parsed = parseApprovalFromResult(raw, 'decision');
      const decision = parsed.indeterminate
        ? 'indeterminate'
        : parsed.approved
          ? 'approved'
          : 'denied';
      newDecisions.set(batch[k].executionId, decision);
    });
  }

  const replayed = newDecisions.size;
  // ★覆盖率 = 已重跑 / **可重跑总数**，不是 / 全部执行数。见上方 replayableTotal 注释。
  const coverage = replayableTotal > 0 ? replayed / replayableTotal : 0;

  // ★双判门槛（ADR 0033 §3.4）：条数与代表性比例都得够。
  //   两个 reason 分开——「再攒些数据」和「大多不可回放，得去开开关」是不同的动作。
  const counts = {
    /** 该版本下的全部执行数（全量，非 LIMIT 后）。 */
    sampleSize: totalCount,
    /** 其中可重跑的全部条数（全量）——coverage 的分母。 */
    replayable: replayableTotal,
    /** 实际重跑成功的条数——估算的真实分母。 */
    replayed,
    replayFailed,
    coverage,
    /** 可重跑数超过单次上限，本次只跑了最近的 limit 条。 */
    truncated: replayableTotal > MAX_REPLAY,
    /** 时间预算耗尽提前停止——与 truncated 是两回事，必须分开回报。 */
    deadlineHit,
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
      message: `可重跑的 ${replayableTotal} 条里只成功重跑了 ${replayed} 条（${Math.round(coverage * 100)}%，需要 ${Math.round(MIN_COVERAGE * 100)}%），结论不足以外推。`,
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

  // ★outcome taxonomy 缺省时**不能**当成空集合。
  //   空 positive set 会让任何结局都进不了正面分子，正面率**恒为 0**——
  //   一个看起来正常的错数字（第八轮 P0-4：UI 没传，正面率就一直是 0%）。
  //   缺省时用平台默认词汇；仍拿不到就在 caveats 里说明，而不是静默算 0。
  const positiveOutcomes = parseList(url.searchParams.get('positiveOutcomes'));
  const negativeOutcomes = parseList(url.searchParams.get('negativeOutcomes'));
  const usedDefaultTaxonomy = positiveOutcomes.length === 0;

  const estimate = estimateWhatIf(samples, newDecisions, {
    positiveOutcomes: usedDefaultTaxonomy ? DEFAULT_POSITIVE_OUTCOMES : positiveOutcomes,
    negativeOutcomes: negativeOutcomes.length === 0 ? DEFAULT_NEGATIVE_OUTCOMES : negativeOutcomes,
    approveDecisions: APPROVE_DECISIONS,
  });

  return NextResponse.json({
    policyId: id,
    baseVersion,
    targetVersion,
    comparable: true,
    ...estimate,
    // 用了默认词汇就明说——否则用户会以为正面率是按他自己的口径算的
    caveats: usedDefaultTaxonomy
      ? [...estimate.caveats, 'DEFAULT_OUTCOME_TAXONOMY']
      : estimate.caveats,
    // ★counts 放在 estimate **之后**：estimate 自带一个 sampleSize
    //   （= 可重跑样本数），会覆盖掉全量口径，导致成功响应与不可比响应报的
    //   sampleSize 是两个不同的数，coverage 的分母也对不上（第八轮 P0-3）。
    ...counts,
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
