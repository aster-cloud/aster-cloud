// P0-A S1（信任层5 transition authorization）：创建/撤销「已批准升级」manifest 服务。
//
// createUpgradeManifest：对一份回归报告，签发 + 验签 + 持久化一个 upgrade-manifest（证「baseline X →
// current Y 是被批准的有方向升级」），并把证据（manifestHash + transitionVerified）挂回报告 reportJson。
//
// ★铁律（S1 诚实核心）：
//   - manifest 是**层5 证据**（批准了方向），**不**证明执行环境是 X/Y（层3）——挂证据**绝不**改报告 signability，
//     携此报告仍 UNSIGNABLE（provenance 未验证）。本模块只写 approvedTransitionManifestHash/transitionVerified，
//     **不碰** unsignableReasons/signability。
//   - 签发走独立 Vault Transit key（密钥分离）+ 2-人 ceremony；验签只从受信 regression-transition 公钥集
//     （不信工件自报 keyId）。
//   - 声明身份 SoD：approvedBy(=admin) != report.createdBy——应用层 + 0040 INSERT trigger 双拦。

import { createHash, randomUUID } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
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
  // ★X/Y 须与**报告实际 toolchain 事实**一致（防批准一个与报告无关的方向）。报告的 current 在
  // currentRuntimeToolchainId；baseline 在 case.baselineToolchainId（取任一 runnable case 的 baseline）。
  const runReport = report.reportJson as unknown as RunReport;
  const reportCurrent = report.currentRuntimeToolchainId;
  const reportBaselines = new Set(
    (runReport.cases ?? []).map((c) => c.baselineToolchainId).filter((b): b is string => typeof b === 'string')
  );
  if (reportCurrent !== null && reportCurrent !== currentToolchainId) {
    throw new Error('transition_mismatch: currentToolchainId does not match report currentRuntimeToolchainId');
  }
  if (reportBaselines.size > 0 && !reportBaselines.has(baselineToolchainId)) {
    throw new Error('transition_mismatch: baselineToolchainId not among report case baselines');
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
    // ★重新验签（不信表行）：用存储的签名工件对存储的 keyId 验签。
    const verify = await verifyRegressionTransition(m.keyId, m.canonicalPayloadB64url, m.signature);
    if (verify.status !== 'verified' || !verify.manifest) continue;
    // ★核对存储列与**签名体**一致（防：验签通过但存储列被篡改成指向别的方向/policy）。
    if (
      verify.manifest.baselineToolchainId !== m.baselineToolchainId ||
      verify.manifest.currentToolchainId !== m.currentToolchainId ||
      verify.manifest.policyId !== m.policyId ||
      verify.manifest.approvedBy !== m.approvedBy
    ) {
      continue;
    }
    // ★核对签名体的 policyId/reportHash 与父报告事实一致（防挂到别的报告）。
    if (m.policyId !== report.policyId || m.reportHash !== report.reportHash) continue;
    // ★manifestHash 须 = sha256(被签 canonical bytes)（存储列与签名工件绑定）。
    const recomputedHash = sha256Hex(Buffer.from(m.canonicalPayloadB64url, 'base64url').toString('utf8'));
    if (recomputedHash !== m.manifestHash) continue;

    return { approvedTransitionManifestHash: m.manifestHash, transitionVerified: true };
  }
  return { approvedTransitionManifestHash: null, transitionVerified: null };
}
