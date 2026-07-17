/**
 * 规则集升级回归工具端点（平台管理员，ADR 0030 M1 附录 B.5）。
 *
 * POST /api/admin/rule-regression
 *   { action: "freeze", policyId, policyVersionRowId?, limit?, handwrittenCases?[] }
 *     → 从 Execution 冻结候选 + 手写边界 case 为不可变 RegressionCase golden。
 *   { action: "run", policyId, policyVersionRowId, thresholds? }
 *     → 对冻结 case 回放，canonical-diff，出四态报告（落 RegressionReport 审计 artifact）。
 *
 * 门禁：requireAdmin（平台管理员，users.isAdmin）+ requireLicenseWriteOk（写操作）。
 * PII：冻结明文 inputJson 受 policy owner 的 replayRetentionEnabled opt-in 约束（runner 内判）。
 *
 * ★M1 comparisonMode=FROZEN_BASELINE_VS_CURRENT_BACKEND：升级前 freeze，部署新版后 run gate。
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin-auth';
import { requireLicenseWriteOk } from '@/lib/license-write-gate';
import { db, auditLogs, policies, regressionReports, regressionCases, regressionDriftApprovals } from '@/lib/prisma';
import { and, desc, eq } from 'drizzle-orm';
import {
  freezeFromExecutions,
  freezeHandwritten,
  run,
  createDriftApproval,
  getEffectiveStatus,
  verifyStoredReportIntegrity,
  deriveReportSignabilityDetail,
  type HandwrittenCaseInput,
  type RunReport,
} from '@/services/policy/rule-regression-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/rule-regression?policyId=...[&policyVersionRowId=...][&reportId=...][&verify=1]
 *   - reportId + verify=1 → 离线核验：复算 reportHash + 逐项比对报告承诺 caseHash vs 当前 golden。
 *   - reportId 指定 → 返回单份报告详情（reportJson，CCO 可签字 artifact）。
 *   - 否则返回该 policy（可选版本）的报告列表 + 冻结 case 概览。
 *
 * 只读——不改状态，故只 requireAdmin（不需 license write gate）。
 */
export async function GET(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;

  const url = new URL(req.url);
  const policyId = url.searchParams.get('policyId');
  const policyVersionRowId = url.searchParams.get('policyVersionRowId');
  const reportId = url.searchParams.get('reportId');
  const verify = url.searchParams.get('verify') === '1';

  if (reportId && verify) {
    // ★离线核验：**存储完整性 + 当前 golden 一致性**——复算 reportHash（相对同库 reportHash 行值，报告
    // JSON 未被单独改）+ 从当前 RegressionCase 行的实际字段**重算** caseHash 并三者比对（报告承诺 == 存储
    // == 重算）。抓 golden 被替换/改字段没改 caseHash/覆盖集变化。仅 m1.2+ 报告支持 golden 承诺。
    // ★非 CCO 数字签名验证：期望 reportHash 取自同库行，检测不到「同时改 reportJson+reportHash」；要证明
    // CCO 已签内容须另接可信签名 artifact（见 verifyStoredReportIntegrity doc）。
    const res = await verifyStoredReportIntegrity(reportId);
    if (!res) {
      return NextResponse.json({ error: 'report_not_found' }, { status: 404 });
    }
    // ★Item 2：verdict 已含 signabilityConsistent/derivedSignability；顶层再投影便于详情消费。
    const vRun = res.report.reportJson as unknown as RunReport;
    const vSig = deriveReportSignabilityDetail(vRun);
    return NextResponse.json({
      report: res.report,
      verdict: res.verdict,
      signability: vSig.signability,
      unsignableLegacyCases: vSig.unsignableLegacyCases,
      signablePass: vRun.status === 'PASS' && vSig.signability === 'SIGNABLE',
    });
  }

  if (reportId) {
    // ★P0-4：单份报告返回 report + 有效审批 + **派生有效状态**（ACCEPTED_DRIFT_WITH_APPROVAL 由 join 算，
    // 报告行 status 不改）。这样 CCO 面板既看到原始 FAIL_REGRESSION 又看到「已受控接受」的诚实结论。
    const es = await getEffectiveStatus(reportId);
    if (!es) {
      return NextResponse.json({ error: 'report_not_found' }, { status: 404 });
    }
    const approvals = await db.query.regressionDriftApprovals.findMany({
      where: eq(regressionDriftApprovals.reportId, reportId),
      orderBy: [desc(regressionDriftApprovals.createdAt)],
    });
    // ★Item 2：单报告详情顶层投影 signability/signablePass（与列表一致，用派生结果防详情端残留双口径）。
    const runReport = es.report.reportJson as unknown as RunReport;
    const sig = deriveReportSignabilityDetail(runReport);
    return NextResponse.json({
      report: es.report,
      effectiveStatus: es.effectiveStatus,
      approvals,
      signability: sig.signability,
      unsignableLegacyCases: sig.unsignableLegacyCases,
      signabilityConsistent: sig.declaredConsistent,
      signablePass: runReport.status === 'PASS' && sig.signability === 'SIGNABLE',
    });
  }

  if (!policyId) {
    return NextResponse.json({ error: 'invalid_query', message: 'policyId or reportId required' }, { status: 400 });
  }

  const reportWhere = policyVersionRowId
    ? and(eq(regressionReports.policyId, policyId), eq(regressionReports.policyVersionRowId, policyVersionRowId))
    : eq(regressionReports.policyId, policyId);
  const caseWhere = policyVersionRowId
    ? and(eq(regressionCases.policyId, policyId), eq(regressionCases.policyVersionRowId, policyVersionRowId))
    : eq(regressionCases.policyId, policyId);

  const [reportRows, cases] = await Promise.all([
    db.query.regressionReports.findMany({
      where: reportWhere,
      orderBy: [desc(regressionReports.createdAt)],
      limit: 50,
      columns: {
        id: true, policyVersionRowId: true, status: true, comparisonMode: true,
        caseCount: true, runnableCaseCount: true, passedCaseCount: true,
        failedCaseCount: true, nonReplayableCaseCount: true, reportHash: true,
        currentRuntimeToolchainId: true, createdAt: true,
        // ★Item 2：读 reportJson 派生 signability——列表也要暴露签字资格，否则 PASS+UNSIGNABLE 在 CCO 面板
        // 仍显示绿色可签字（Codex 复审：双口径不能从核心函数搬到消费端）。
        reportJson: true,
      },
    }),
    db.query.regressionCases.findMany({
      where: caseWhere,
      orderBy: [desc(regressionCases.createdAt)],
      limit: 500,
      columns: {
        id: true, policyVersionRowId: true, functionName: true, locale: true,
        expectedDecision: true, sourceKind: true, coverageTags: true,
        inputJson: true, canonicalInputHash: true, createdAt: true,
      },
    }),
  ]);

  // ★Item 2：每份报告派生 signability + signablePass（不回传庞大 reportJson，只投影签字资格）。
  const reports = reportRows.map((r) => {
    const runReport = r.reportJson as unknown as RunReport;
    // ★Item 2：用**派生**结果（signability + count 都来自 cases 事实，非不可信顶层声明）。
    const sig = deriveReportSignabilityDetail(runReport);
    const { reportJson: _omit, ...meta } = r;
    void _omit;
    return {
      ...meta,
      signability: sig.signability,
      unsignableLegacyCases: sig.unsignableLegacyCases,
      signabilityConsistent: sig.declaredConsistent,
      // 「绿色可签字通过」的唯一判据——UI 据此着色，不能只看 status。
      signablePass: runReport.status === 'PASS' && sig.signability === 'SIGNABLE',
    };
  });

  // case 概览：不回传明文 inputJson（PII），只标是否 replay-limited。
  const caseSummary = cases.map((c) => ({
    id: c.id,
    policyVersionRowId: c.policyVersionRowId,
    functionName: c.functionName,
    locale: c.locale,
    expectedDecision: c.expectedDecision,
    sourceKind: c.sourceKind,
    coverageTags: c.coverageTags,
    replayLimited: c.inputJson == null,
    canonicalInputHash: c.canonicalInputHash,
    createdAt: c.createdAt,
  }));

  return NextResponse.json({ policyId, reports, cases: caseSummary });
}

async function audit(userId: string, action: string, resourceId: string, metadata: object): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      id: crypto.randomUUID(),
      userId,
      action: `rule_regression.${action}`,
      resource: 'rule-regression',
      resourceId,
      metadata,
    });
  } catch {
    // 审计失败不阻断主流程（与其它 admin 端点一致）。
  }
}

/** 解析策略 owner（tenant）——决定 PII opt-in + 回放 tenant 上下文。 */
async function resolvePolicyOwner(policyId: string): Promise<{ ownerUserId: string; teamId: string | null } | null> {
  const p = await db.query.policies.findFirst({
    where: eq(policies.id, policyId),
    columns: { userId: true, teamId: true },
  });
  if (!p) return null;
  return { ownerUserId: p.userId, teamId: p.teamId };
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const writeGate = await requireLicenseWriteOk();
  if (writeGate) return writeGate;

  const body = (await req.json().catch(() => null)) as {
    action?: unknown;
    policyId?: unknown;
    policyVersionRowId?: unknown;
    limit?: unknown;
    handwrittenCases?: unknown;
    thresholds?: unknown;
  } | null;

  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'invalid_body', message: 'Request body must be a JSON object' }, { status: 400 });
  }
  const action = body.action;
  if (action !== 'freeze' && action !== 'run') {
    return NextResponse.json({ error: 'invalid_action', message: 'action must be "freeze" or "run"' }, { status: 400 });
  }
  if (typeof body.policyId !== 'string' || body.policyId.length === 0) {
    return NextResponse.json({ error: 'invalid_policyId', message: 'policyId is required' }, { status: 400 });
  }
  const policyId = body.policyId;

  const owner = await resolvePolicyOwner(policyId);
  if (!owner) {
    return NextResponse.json({ error: 'policy_not_found', message: `Policy ${policyId} not found` }, { status: 404 });
  }
  // 回放 tenant：团队策略用 teamId，否则 owner userId（与 execute 路径一致）。
  const tenantId = owner.teamId || owner.ownerUserId;

  try {
    if (action === 'freeze') {
      const policyVersionRowId =
        typeof body.policyVersionRowId === 'string' ? body.policyVersionRowId : undefined;
      const limit = typeof body.limit === 'number' && body.limit > 0 ? Math.min(body.limit, 1000) : undefined;

      // 1. 从 Execution 冻结候选。
      const fromExecutions = await freezeFromExecutions({
        policyId,
        policyVersionRowId,
        limit,
        actorUserId: admin.userId,
        ownerUserId: owner.ownerUserId,
      });

      // 2. 冻结手写边界 case（可选）。
      let handwritten: Awaited<ReturnType<typeof freezeHandwritten>> = {
        frozen: 0, duplicate: 0, skipped: 0, outputConflicts: [], caseIds: [], skippedReasons: [],
      };
      const hwRaw = body.handwrittenCases;
      if (Array.isArray(hwRaw) && hwRaw.length > 0) {
        const hwCases = validateHandwrittenCases(hwRaw);
        if (hwCases instanceof NextResponse) return hwCases;
        handwritten = await freezeHandwritten({
          policyId,
          cases: hwCases,
          actorUserId: admin.userId,
          ownerUserId: owner.ownerUserId,
          tenantId,
        });
      }

      // outputConflicts = 同 input 历史产不同 output 的漂移信号，审计必须留痕（不静默）。
      const totalConflicts = fromExecutions.outputConflicts.length + handwritten.outputConflicts.length;
      await audit(admin.userId, 'freeze', policyId, {
        policyVersionRowId,
        fromExecutions: { frozen: fromExecutions.frozen, duplicate: fromExecutions.duplicate },
        handwritten: { frozen: handwritten.frozen, duplicate: handwritten.duplicate, skipped: handwritten.skipped },
        outputConflicts: totalConflicts,
      });

      return NextResponse.json({ action: 'freeze', policyId, fromExecutions, handwritten });
    }

    // action === 'run'
    if (typeof body.policyVersionRowId !== 'string' || body.policyVersionRowId.length === 0) {
      return NextResponse.json(
        { error: 'invalid_policyVersionRowId', message: 'policyVersionRowId is required for run' },
        { status: 400 }
      );
    }
    // ★P0-2（CCO 复审）：run **不接受**请求级 thresholds 下调——覆盖门禁恒用 DEFAULT_THRESHOLDS。
    // 否则同一 admin 既定阈值又跑又得 PASS，报告无法证明门禁未为本次升级临时放宽。传了就 400 明确拒，
    // 不静默忽略（避免调用方以为放宽生效）。放宽须走独立 CCO approval artifact（P0-4，另表）。
    if (body.thresholds !== undefined) {
      return NextResponse.json(
        {
          error: 'thresholds_not_allowed',
          message:
            'run does not accept request-level coverage thresholds (P0-2). ' +
            'Coverage gate is fixed to signable defaults; exceptions require a CCO approval artifact.',
        },
        { status: 400 }
      );
    }

    const report = await run({
      policyId,
      policyVersionRowId: body.policyVersionRowId,
      actorUserId: admin.userId,
      tenantId,
    });

    await audit(admin.userId, 'run', policyId, {
      policyVersionRowId: body.policyVersionRowId,
      reportId: report.reportId,
      status: report.status,
      // ★Item 2：签字级审计同时记 signability（不可只记 status，否则审计漏「不可签字」事实）。
      signability: report.signability,
      unsignableLegacyCases: report.unsignableLegacyCases,
      reportHash: report.reportHash,
    });

    return NextResponse.json(report);
  } catch (e) {
    console.error('[rule-regression] error:', e);
    return NextResponse.json(
      { error: 'internal_error', message: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/admin/rule-regression（受控接受漂移审批，P0-4）
 *   { action: "approve-drift", reportId, reason, ticketRef?, expiresAt(ISO) }
 *     → 对失败报告创建受控接受漂移审批（★职责分离：审批人 != 报告创建者，runner 强制）。
 *   { action: "revoke-approval", approvalId }
 *     → 撤销审批（append-only，走 revokedAt/revokedBy 一次性）。
 */
export async function PUT(req: NextRequest) {
  const admin = await requireAdmin();
  if (admin instanceof NextResponse) return admin;
  const writeGate = await requireLicenseWriteOk();
  if (writeGate) return writeGate;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  try {
    if (body.action === 'approve-drift') {
      if (typeof body.reportId !== 'string' || typeof body.reason !== 'string' || typeof body.expiresAt !== 'string') {
        return NextResponse.json(
          { error: 'invalid_input', message: 'reportId, reason, expiresAt(ISO) required' },
          { status: 400 }
        );
      }
      // ★reason trim 后必须非空（CCO 审批需实质理由，不接受空白）。
      const reason = body.reason.trim();
      if (reason.length === 0) {
        return NextResponse.json({ error: 'invalid_reason', message: 'reason must be non-blank' }, { status: 400 });
      }
      const expiresAt = new Date(body.expiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        return NextResponse.json({ error: 'invalid_expiresAt' }, { status: 400 });
      }
      const result = await createDriftApproval({
        reportId: body.reportId,
        reason,
        ticketRef: typeof body.ticketRef === 'string' ? body.ticketRef : null,
        approvedBy: admin.userId,
        expiresAt,
      });
      await audit(admin.userId, 'approve-drift', body.reportId, {
        approvalId: result.approvalId,
        approvalHash: result.approvalHash,
        reason: body.reason,
      });
      return NextResponse.json({ action: 'approve-drift', ...result });
    }

    if (body.action === 'revoke-approval') {
      if (typeof body.approvalId !== 'string') {
        return NextResponse.json({ error: 'invalid_input', message: 'approvalId required' }, { status: 400 });
      }
      const existing = await db.query.regressionDriftApprovals.findFirst({
        where: eq(regressionDriftApprovals.id, body.approvalId),
      });
      if (!existing) return NextResponse.json({ error: 'approval_not_found' }, { status: 404 });
      if (existing.revokedAt != null) {
        return NextResponse.json({ error: 'already_revoked' }, { status: 409 });
      }
      // 撤销走 append-only 允许的 revoke 列（DB trigger 只放行 revokedAt/revokedBy NULL→非 NULL）。
      await db
        .update(regressionDriftApprovals)
        .set({ revokedAt: new Date(), revokedBy: admin.userId })
        .where(eq(regressionDriftApprovals.id, body.approvalId));
      await audit(admin.userId, 'revoke-approval', existing.policyId, { approvalId: body.approvalId });
      return NextResponse.json({ action: 'revoke-approval', approvalId: body.approvalId, revoked: true });
    }

    return NextResponse.json({ error: 'invalid_action', message: 'approve-drift | revoke-approval' }, { status: 400 });
  } catch (e) {
    console.error('[rule-regression] error:', e);
    return NextResponse.json(
      { error: 'internal_error', message: e instanceof Error ? e.message : 'Internal error' },
      { status: 500 }
    );
  }
}

/** 校验手写 case 输入。返回 NextResponse（400）表示非法。 */
function validateHandwrittenCases(raw: unknown[]): HandwrittenCaseInput[] | NextResponse {
  const MAX_HANDWRITTEN = 200;
  if (raw.length > MAX_HANDWRITTEN) {
    return NextResponse.json(
      { error: 'too_many_cases', message: `handwrittenCases exceeds ${MAX_HANDWRITTEN}` },
      { status: 400 }
    );
  }
  const out: HandwrittenCaseInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] as Record<string, unknown>;
    if (!c || typeof c !== 'object') {
      return NextResponse.json({ error: 'invalid_case', message: `case[${i}] must be an object` }, { status: 400 });
    }
    if (typeof c.policyVersionRowId !== 'string' || typeof c.functionName !== 'string') {
      return NextResponse.json(
        { error: 'invalid_case', message: `case[${i}] requires policyVersionRowId and functionName` },
        { status: 400 }
      );
    }
    if (c.input == null || typeof c.input !== 'object') {
      return NextResponse.json({ error: 'invalid_case', message: `case[${i}].input must be an object/array` }, { status: 400 });
    }
    const coverageTags = Array.isArray(c.coverageTags) ? c.coverageTags.filter((t): t is string => typeof t === 'string') : [];
    out.push({
      policyVersionRowId: c.policyVersionRowId,
      functionName: c.functionName,
      locale: typeof c.locale === 'string' ? c.locale : undefined,
      input: c.input as Record<string, unknown> | unknown[],
      coverageTags,
    });
  }
  return out;
}
