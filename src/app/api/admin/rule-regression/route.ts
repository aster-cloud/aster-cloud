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
import { db, auditLogs, policies } from '@/lib/prisma';
import { eq } from 'drizzle-orm';
import {
  freezeFromExecutions,
  freezeHandwritten,
  run,
  type HandwrittenCaseInput,
  type CoverageThresholds,
} from '@/services/policy/rule-regression-runner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
    const thresholds = validateThresholds(body.thresholds);
    if (thresholds instanceof NextResponse) return thresholds;

    const report = await run({
      policyId,
      policyVersionRowId: body.policyVersionRowId,
      actorUserId: admin.userId,
      tenantId,
      thresholds,
    });

    await audit(admin.userId, 'run', policyId, {
      policyVersionRowId: body.policyVersionRowId,
      reportId: report.reportId,
      status: report.status,
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

/** 校验并归一自定义阈值（可选）。 */
function validateThresholds(raw: unknown): Partial<CoverageThresholds> | undefined | NextResponse {
  if (raw == null) return undefined;
  if (typeof raw !== 'object') {
    return NextResponse.json({ error: 'invalid_thresholds', message: 'thresholds must be an object' }, { status: 400 });
  }
  const t = raw as Record<string, unknown>;
  const out: Partial<CoverageThresholds> = {};
  for (const key of ['minRunnableCases', 'minApprovedCases', 'minDeniedCases', 'minHandwrittenBoundaryCases'] as const) {
    if (t[key] !== undefined) {
      if (typeof t[key] !== 'number' || (t[key] as number) < 0) {
        return NextResponse.json({ error: 'invalid_thresholds', message: `${key} must be a non-negative number` }, { status: 400 });
      }
      out[key] = t[key] as number;
    }
  }
  return out;
}
