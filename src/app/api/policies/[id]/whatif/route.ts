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
import { loadVocabularyForExecution } from '@/lib/domain-vocabulary-snapshot';
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
/**
 * 重跑**成功率**门槛。注意它衡量的是可靠性（这批跑成功了多少），
 * 不是代表性（样本占全量多少）——后者由 sampleCoverage 如实回报但不设门槛，
 * 因为 MAX_REPLAY 会让它对大策略恒极低（第九/十轮）。
 */
const MIN_SUCCESS_RATE = 0.2;

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
        'What-if 估算需要读取历史执行的明文输入。请先在账户设置中开启「回放与分析授权」——' +
        '它授权平台把执行输入用于分析用途（What-if 重跑既有输入；回归工具还会冻结明文到测试用例）。',
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

  // ★taxonomy fail-fast（第十一轮 item 4）：在**任何重查询与重跑之前**校验。
  //   缺词汇时结论必然不可用，却要先跑 200 次重放才告诉用户——白烧 CPU
  //   与目标服务资源。这里提前拒绝，零 evaluateSource 调用。
  const positiveOutcomes = parseList(url.searchParams.get('positiveOutcomes'));
  const negativeOutcomes = parseList(url.searchParams.get('negativeOutcomes'));
  if (positiveOutcomes.length === 0 && negativeOutcomes.length === 0) {
    return NextResponse.json({
      policyId: id,
      baseVersion,
      targetVersion,
      comparable: false,
      reason: 'NO_OUTCOME_TAXONOMY',
      message:
        '未配置 outcome 词汇（哪些结局算正面/负面）。平台不替租户猜测业务语义——' +
        '请在请求中传 positiveOutcomes/negativeOutcomes 后重试。',
    });
  }

  // 目标版本的源码——重跑的另一半。带 policyId 过滤（版本号在策略内唯一）。
  // ★vocabulary 必须还原（第八/九轮 P0-7）。
  //   `vocabularySnapshotIds` 存的是引用（`{snapshotId, domain, locale}[]`），
  //   需经 `loadVocabularyForExecution` 解析成词汇内容。
  //
  //   ⚠️ 我第八轮曾判定「无需修改」，理由是「生产 execute 路径也不传 vocabulary」——
  //   **那是错的**：我只查了 dashboard 与 v1 两条普通路径，漏了
  //   `secure-execute → loadVocabularyForExecution → evaluateSource(vocabulary)`
  //   这条真实生产链路（第九轮指出）。不带 vocabulary 重跑，用户自定义术语
  //   在规范化阶段翻译不出来，编译失败或语义漂移——那不是「策略变了」，
  //   是我们没把执行环境还原对。
  const [target] = await db
    .select({
      source: policyVersions.source,
      content: policyVersions.content,
      aliasSet: policyVersions.aliasSet,
      vocabularySnapshotIds: policyVersions.vocabularySnapshotIds,
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
  // ★真正的取消（第十一轮 item 5）：deadline 到时 abort 在途 fetch，
  //   而不是只让本 route 提前返回、把请求丢在半空继续消耗目标服务资源。
  const replayAbort = new AbortController();
  const budgetTimer = setTimeout(() => replayAbort.abort(), REPLAY_BUDGET_MS);
  const targetAliasSet = target?.aliasSet ? safeParseAliasSet(target.aliasSet) : null;
  // ★vocabulary fail-closed（第十一轮 item 6）：refs 非空却加载失败时**不得降级**。
  //   降级成内置词汇会让重跑用与真实执行不同的术语解析——那不是「策略变了」，
  //   是我们悄悄换了执行环境，产出的对照决策不可信。宁可拒绝也不给错结论。
  const vocabRefs = target?.vocabularySnapshotIds;
  let targetVocabulary: Record<string, unknown> | undefined;
  if (vocabRefs && vocabRefs.length > 0) {
    let vocab: unknown = null;
    try {
      vocab = await loadVocabularyForExecution(vocabRefs);
    } catch {
      vocab = null;
    }
    if (!vocab) {
      return errorEnvelope({
        code: 'VOCABULARY_UNAVAILABLE',
        message:
          `目标版本 v${targetVersion} 依赖自定义领域词汇，但快照加载失败。` +
          '用内置词汇重跑会得到与真实执行不同的解析结果，故拒绝给出估算。',
        status: 503,
      });
    }
    targetVocabulary = vocab as Record<string, unknown>;
  }

  for (let i = 0; i < replayableRows.length; i += REPLAY_CONCURRENCY) {
    if (Date.now() > deadline) {
      deadlineHit = true;
      break;
    }
    const batch = replayableRows.slice(i, i + REPLAY_CONCURRENCY);
    // ★整批也要能被 deadline 打断，不能只在批次之间看表（第九轮 P0-6）：
    //   批内 8 条并发若都卡到 client 自带的 30s timeout，20s 预算形同虚设。
    //   Promise.race 让剩余预算一到就返回，未完成的请求结果被丢弃
    //   （它们不会进 newDecisions，等价于计入 replayFailed）。
    const remaining = Math.max(deadline - Date.now(), 0);
    const settled = await Promise.race([
      Promise.allSettled(
      batch.map((r) =>
        // ★simulate=true：这是模拟不是真实执行，不计配额、不写指标/审计
        //   （第八轮 P0-1：否则查一次估算就扣掉上百次配额并污染经营 KPI）
        apiClient.evaluateSource(targetSource, r.input as Record<string, unknown>, {
          locale: r.locale ?? undefined,
          functionName: r.functionName ?? undefined,
          aliasSet: targetAliasSet ?? undefined,
          vocabulary: targetVocabulary,
          simulate: true,
          signal: replayAbort.signal,
        }),
      ),
      ),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), remaining)),
    ]);
    // race 超时返回 null —— 本批全部计为失败并停止后续批次。
    // abort 已由 budgetTimer 触发，在途 fetch 会真正断开。
    if (settled === null) {
      deadlineHit = true;
      replayFailed += batch.length;
      break;
    }
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

  clearTimeout(budgetTimer);

  const replayed = newDecisions.size;

  // ★统计契约必须守恒（第十一轮）：planned = started + notStarted，
  //   started = succeeded + failed。之前 attempted 同时表示「计划数」与
  //   「已开始数」，deadline 提前退出时两者不等，数字对不上却没人发现。
  const planned = replayableRows.length;
  const succeeded = replayed;
  const failed = replayFailed;
  const started = succeeded + failed;
  const notStarted = Math.max(planned - started, 0);

  // 两个比率语义不同，必须分开（第十轮）：
  //   · replaySuccessRate = succeeded / started —— 已开始的这批**可靠性**。
  //     分母用 started 而非 planned：deadline 未启动的那些不是「失败」，
  //     混进分母会把「跑得慢」误判成「跑得不对」。
  //   · sampleCoverage = succeeded / replayableTotal —— **代表性**，
  //     不作门槛（MAX_REPLAY 让它对大策略恒极低），仅如实回报。
  const replaySuccessRate = started > 0 ? succeeded / started : 0;
  const sampleCoverage = replayableTotal > 0 ? succeeded / replayableTotal : 0;

  // ★双判门槛（ADR 0033 §3.4）：条数与代表性比例都得够。
  //   两个 reason 分开——「再攒些数据」和「大多不可回放，得去开开关」是不同的动作。
  const counts = {
    /** 该版本下的全部执行数（全量，非 LIMIT 后）。 */
    sampleSize: totalCount,
    /** 其中可重跑的全部条数（全量）。 */
    replayable: replayableTotal,
    /** 本次计划重跑的条数（受 MAX_REPLAY 与 input 非空约束）。 */
    planned,
    /** 实际发起了重跑的条数 = succeeded + failed。 */
    started,
    /** 重跑成功并拿到对照决策的条数——**估算的真实分母**。 */
    replayed: succeeded,
    /** 重跑失败的条数（reject / error 非空 / result 为空）。 */
    replayFailed: failed,
    /** deadline 提前退出导致从未发起的条数。 */
    notStarted,
    /** succeeded / started —— 可靠性，门槛用它。 */
    replaySuccessRate,
    /** succeeded / replayable —— 代表性，**不作门槛**，仅如实回报。 */
    sampleCoverage,
    /** 可重跑数超过单次上限，本次只跑了最近的 limit 条。 */
    truncated: replayableTotal > MAX_REPLAY,
    /** 时间预算耗尽提前停止——与 truncated 是两回事。 */
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
  if (replaySuccessRate < MIN_SUCCESS_RATE) {
    return NextResponse.json({
      policyId: id,
      baseVersion,
      targetVersion,
      comparable: false,
      reason: 'LOW_REPLAY_SUCCESS_RATE',
      message: `本次发起重跑 ${started} 条，仅 ${succeeded} 条成功（${Math.round(replaySuccessRate * 100)}%，需要 ${Math.round(MIN_SUCCESS_RATE * 100)}%），失败过多，结论不可信。`,
      ...counts,
    });
  }

  // ★估算样本 = **真正重跑成功**的那批，不是所有 REPLAYABLE 行（第十一轮）。
  //
  //   重跑失败的行没有对照决策，`estimateWhatIf` 拿不到新决策就当作
  //   「决策未变」——它们的 outcome/value 仍然进入基线分子分母，却对
  //   changed 毫无贡献。实测：40 成功 + 10 失败时 estimatedValueDelta=+4800，
  //   只用成功的 40 条则是 -4000 —— **方向直接翻转**。
  //   这不是精度问题，是把「不知道」当成「没变化」造成的系统性偏差。
  const succeededRows = baseRows.filter((r) => newDecisions.has(r.executionId));
  const samples: OutcomeSample[] = succeededRows.map((r) => ({
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
  const estimate = estimateWhatIf(samples, newDecisions, {
    positiveOutcomes,
    negativeOutcomes,
    approveDecisions: APPROVE_DECISIONS,
  });

  return NextResponse.json({
    policyId: id,
    baseVersion,
    targetVersion,
    comparable: true,
    ...estimate,
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
