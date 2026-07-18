// P0-A S1（信任层5 transition authorization）：创建/撤销「已批准升级」manifest 服务。
//
// createUpgradeManifest：对一份回归报告，签发 + 验签 + 持久化一个 upgrade-manifest（证「baseline X →
// current Y 是被批准的有方向升级」）。★证据**不写回报告**（报告 append-only）——manifest 是独立、可撤销、
// 可过期的 artifact；报告的 transition 证据由读路径（deriveReportTransitionEvidence / reportIdsWithVerified-
// Transition）**重新验签** manifest 表动态派生（单一真相源，详情/列表共用 isStoredManifestVerified）。
//
// ★铁律（S1 诚实核心）：
//   - manifest 是**层5 证据**（批准了方向），**不**证明执行环境是 X/Y（层3）——挂证据**绝不**改报告 signability，
//     携此报告仍 UNSIGNABLE（provenance 未验证）。本模块只写 approvedTransitionManifestHash/transitionVerified，
//     **不碰** unsignableReasons/signability。
//   - 签发走独立 Vault Transit key（密钥分离）+ 2-人 ceremony；验签只从受信 regression-transition 公钥集
//     （不信工件自报 keyId）。
//   - 声明身份 SoD：approvedBy(=admin) != report.createdBy——应用层 + 0040 INSERT trigger 双拦。

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, regressionReports, regressionUpgradeManifests } from '@/lib/prisma';
import { signRegressionTransition } from '@/lib/license-signing-client';
import { verifyRegressionTransition } from '@/lib/regression-transition-verify';
import type { RunReport } from '@/services/policy/rule-regression-runner';

export interface CreateUpgradeManifestParams {
  reportId: string;
  /** 升级方向 X（baseline toolchainId）。 */
  baselineToolchainId: string;
  /** 升级方向 Y（current toolchainId）。 */
  currentToolchainId: string;
  /** 批准人（admin.userId）——须 != report.createdBy（声明身份 SoD）。 */
  approvedBy: string;
  /** 有效期（ISO 或 Date）。 */
  expiresAt: Date;
}

export interface CreateUpgradeManifestResult {
  manifestId: string;
  manifestHash: string;
  keyId: string;
  keyVersion: string;
  transitionVerified: boolean;
}

function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * 对报告 reportId 创建已批准升级 manifest。签发 → 验签 → 持久化 → 挂证据回报告。
 * ★挂证据**不改** signability——携此报告仍 UNSIGNABLE（层5≠层3）。
 */
export async function createUpgradeManifest(
  params: CreateUpgradeManifestParams,
): Promise<CreateUpgradeManifestResult> {
  const { reportId, baselineToolchainId, currentToolchainId, approvedBy, expiresAt } = params;

  if (baselineToolchainId === currentToolchainId) {
    throw new Error('invalid_transition: baselineToolchainId must differ from currentToolchainId (no directional upgrade)');
  }
  if (expiresAt.getTime() <= Date.now()) {
    throw new Error('invalid_expiry: expiresAt not in future');
  }

  const report = await db.query.regressionReports.findFirst({ where: eq(regressionReports.id, reportId) });
  if (!report) throw new Error('report_not_found');
  // ★声明身份 SoD：批准人 != 报告创建者（应用层拦；0040 trigger 兜底）。
  if (report.createdBy === approvedBy) {
    throw new Error('separation_of_duties: approver equals report creator');
  }

  // ★X/Y 须与**报告实际 toolchain 事实**一致（防批准一个与报告无关的方向）。★Codex 复审 P1：**fail-closed**
  // ——缺事实（currentRuntimeToolchainId=null / 无 case baseline）时**拒绝**；baseline 集合**必须严格单一且 == X**
  // （多 baseline 报告的报告级批准语义不清）。★Codex v3 建议：纯本地检查前移到**签名前**（无效请求不浪费远程
  // ceremony），且要求**每个 case 都携带 baseline**（防「一部分 X、一部分缺」被当单一 baseline 放行）。
  const runReport = report.reportJson as unknown as RunReport;
  const reportCurrent = report.currentRuntimeToolchainId;
  if (reportCurrent === null) {
    throw new Error('transition_mismatch: report has no single currentRuntimeToolchainId (mixed/unknown); cannot approve transition');
  }
  if (reportCurrent !== currentToolchainId) {
    throw new Error('transition_mismatch: currentToolchainId does not match report currentRuntimeToolchainId');
  }
  const reportCases = runReport.cases ?? [];
  if (reportCases.length === 0 || !reportCases.every((c) => typeof c.baselineToolchainId === 'string' && c.baselineToolchainId.length > 0)) {
    throw new Error('transition_mismatch: report has cases without a baseline toolchain; cannot establish single baseline');
  }
  const reportBaselines = new Set(reportCases.map((c) => c.baselineToolchainId as string));
  if (reportBaselines.size !== 1) {
    throw new Error(`transition_mismatch: report baseline toolchain set must be exactly one value (got ${reportBaselines.size}); report-level transition approval requires a single baseline`);
  }
  if (!reportBaselines.has(baselineToolchainId)) {
    throw new Error('transition_mismatch: baselineToolchainId does not match report case baseline');
  }

  // 被签 manifest（自证协议域：purpose + 方向 + policy + 批准人 + reportHash + **expiresAt**）。
  // ★Codex 复审 P1：expiresAt 进签名体（否则有效期不被签名保护，可被篡改）。
  const expiresAtIso = expiresAt.toISOString();
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    purpose: 'regression-transition',
    baselineToolchainId,
    currentToolchainId,
    policyId: report.policyId,
    approvedBy,
    reportHash: report.reportHash, // 钉死针对的确切报告内容。
    expiresAt: expiresAtIso,
  };

  // 签发（独立 key + 2-人 ceremony）。
  const signed = await signRegressionTransition(manifest);

  // ★验签（只从受信 regression-transition 公钥集，不信工件自报 keyId）+ re-assert purpose + 方向。
  const verify = await verifyRegressionTransition(signed.keyId, signed.canonicalPayloadB64url, signed.signature);
  if (verify.status !== 'verified' || !verify.manifest) {
    throw new Error(`manifest_verify_failed: ${verify.status} (${verify.reason ?? '-'})`);
  }
  // ★Codex 复审 P1：验签后**全字段**核对（防 signing-api 返回不相关字节 / 合法签名体错关联到别的报告/policy/
  // 批准人/期限）。签名体的每个安全字段都须 == 请求/父报告事实。
  const vm = verify.manifest as Record<string, unknown>;
  if (
    vm.baselineToolchainId !== baselineToolchainId ||
    vm.currentToolchainId !== currentToolchainId ||
    vm.policyId !== report.policyId ||
    vm.approvedBy !== approvedBy ||
    vm.reportHash !== report.reportHash ||
    vm.expiresAt !== expiresAtIso
  ) {
    throw new Error('manifest_mismatch: signed manifest fields do not match requested transition/report');
  }

  // manifestHash = sha256(被签 canonical payload bytes)——报告挂它作证据。
  const canonicalBytes = Buffer.from(signed.canonicalPayloadB64url, 'base64url');
  const manifestHash = sha256Hex(canonicalBytes.toString('utf8'));

  const manifestId = randomUUID();
  // 持久化（0040 INSERT trigger 强制 backdate/父一致/SoD/方向/expiry）。
  await db.insert(regressionUpgradeManifests).values({
    id: manifestId,
    reportId,
    reportHash: report.reportHash,
    policyId: report.policyId,
    policyVersionRowId: report.policyVersionRowId,
    baselineToolchainId,
    currentToolchainId,
    canonicalPayloadB64url: signed.canonicalPayloadB64url,
    signature: signed.signature,
    keyId: signed.keyId,
    keyVersion: signed.keyVersion,
    approvedBy,
    expiresAt,
    manifestHash,
  } as typeof regressionUpgradeManifests.$inferInsert);

  // ★证据不写回报告行：RegressionReport 是 append-only（0037 trigger 冻结所有列，reportJson 不可 UPDATE）。
  // manifest 表是**真相源**；报告的 transition 证据（approvedTransitionManifestHash/transitionVerified）由
  // **读路径 join 未撤销 manifest 动态派生**（见 deriveReportTransitionEvidence + route GET）。这与 drift-approval
  // 由 join 派生 ACCEPTED（不 mutate 报告）一脉相承。★挂证据**绝不**改 signability——携证据报告仍 UNSIGNABLE。

  return {
    manifestId,
    manifestHash,
    keyId: signed.keyId,
    keyVersion: signed.keyVersion,
    transitionVerified: true,
  };
}

/** 读路径派生的 transition 证据（挂到报告响应；≠ 报告行）。 */
export interface ReportTransitionEvidence {
  approvedTransitionManifestHash: string | null;
  transitionVerified: boolean | null;
}

/**
 * ★读路径：从 upgrade-manifest 派生一份报告的 transition 证据（不 mutate append-only 报告行）。
 *
 * ★★Codex 复审 P0：**「表里有行」≠「已验签事实」**——0040 触发器只查结构不验签，且应用角色有全表 INSERT
 * 权限（普通 DB 写能直插任意 canonicalPayload/signature）。故读路径**必须对每个候选 manifest 重新
 * verifyRegressionTransition**（用存储的签名工件），且核对存储的 baseline/current/policyId 与**签名体**一致
 * ——只有**验签通过 + 字段一致**才算 verified。任何伪造/篡改行 → 不计入。
 *
 * 候选范围：未撤销 + 未过期。多条时取最近批准且通过验签的一条。
 * ★这只是**证据**——消费端（signability 派生）绝不因它移除 TOOLCHAIN_PROVENANCE_UNVERIFIED（层5≠层3）。
 */
/** 一行 manifest（存储态）的字段子集——共享验证函数用。 */
type StoredManifest = typeof regressionUpgradeManifests.$inferSelect;

/**
 * ★共享候选验证（详情 + 列表**共用**，防双口径——Codex 复审：列表和详情必须同一验证逻辑）。
 * 「表里有行」≠「已验签」——只有：重新验签通过 + 签名体**全字段** == 存储列 == 父报告事实 + manifestHash 绑定，
 * 才算 verified。任一不符 → false（伪造/重放/延寿/改挂都被挡）。
 */
async function isStoredManifestVerified(
  m: StoredManifest,
  report: { policyId: string; reportHash: string },
): Promise<boolean> {
  const verify = await verifyRegressionTransition(m.keyId, m.canonicalPayloadB64url, m.signature);
  if (verify.status !== 'verified' || !verify.manifest) return false;
  const vm = verify.manifest;
  // ★签名体**全字段** == 存储列（防验签通过但存储列被篡改指向别的方向/policy/批准人/报告/期限）。
  if (
    vm.baselineToolchainId !== m.baselineToolchainId ||
    vm.currentToolchainId !== m.currentToolchainId ||
    vm.policyId !== m.policyId ||
    vm.approvedBy !== m.approvedBy ||
    vm.reportHash !== m.reportHash || // ★防合法签名改挂别报告（存储 reportHash 改了但签名体没改）
    vm.expiresAt !== m.expiresAt.toISOString() // ★防延寿（存储 expiresAt 改长但签名体没改）
  ) {
    return false;
  }
  // ★签名体钉死的 reportHash + policyId == 父报告事实（防重放到别的报告）。
  if (vm.reportHash !== report.reportHash || vm.policyId !== report.policyId) return false;
  // ★manifestHash == sha256(被签 canonical bytes)（存储 hash 列与签名工件绑定）。
  if (sha256Hex(Buffer.from(m.canonicalPayloadB64url, 'base64url').toString('utf8')) !== m.manifestHash) return false;
  return true;
}

export async function deriveReportTransitionEvidence(
  reportId: string,
  now: Date = new Date(),
): Promise<ReportTransitionEvidence> {
  const report = await db.query.regressionReports.findFirst({ where: eq(regressionReports.id, reportId) });
  if (!report) return { approvedTransitionManifestHash: null, transitionVerified: null };

  const rows = await db
    .select()
    .from(regressionUpgradeManifests)
    .where(and(eq(regressionUpgradeManifests.reportId, reportId), isNull(regressionUpgradeManifests.revokedAt)));
  const candidates = rows
    .filter((m) => m.expiresAt.getTime() > now.getTime())
    .sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime());

  for (const m of candidates) {
    if (await isStoredManifestVerified(m, report)) {
      return { approvedTransitionManifestHash: m.manifestHash, transitionVerified: true };
    }
  }
  return { approvedTransitionManifestHash: null, transitionVerified: null };
}

/**
 * ★批量：一组报告中，哪些**有已验签**的活跃 transition manifest（列表用，共享同一验证逻辑，防双口径）。
 * 批量取行 + 逐行验签（≤50 报告，非 N+1 的重复 DB 查）。返回 verified 的 reportId 集合。
 */
export async function reportIdsWithVerifiedTransition(
  reportIds: string[],
  now: Date = new Date(),
): Promise<Set<string>> {
  if (reportIds.length === 0) return new Set();
  const reports = await db.query.regressionReports.findMany({
    where: inArray(regressionReports.id, reportIds),
    columns: { id: true, policyId: true, reportHash: true },
  });
  const reportById = new Map(reports.map((r) => [r.id, r]));
  const rows = await db
    .select()
    .from(regressionUpgradeManifests)
    .where(and(inArray(regressionUpgradeManifests.reportId, reportIds), isNull(regressionUpgradeManifests.revokedAt)));
  const verified = new Set<string>();
  for (const m of rows) {
    if (verified.has(m.reportId)) continue; // 已确认，跳过。
    if (m.expiresAt.getTime() <= now.getTime()) continue;
    const report = reportById.get(m.reportId);
    if (!report) continue;
    if (await isStoredManifestVerified(m, report)) verified.add(m.reportId);
  }
  return verified;
}
