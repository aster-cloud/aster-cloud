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

  // 被签 manifest（自证协议域：purpose + 方向 + policy + 批准人；signing-api 会强制 schema）。
  const manifest: Record<string, unknown> = {
    schemaVersion: 1,
    purpose: 'regression-transition',
    baselineToolchainId,
    currentToolchainId,
    policyId: report.policyId,
    approvedBy,
    reportHash: report.reportHash, // 钉死针对的确切报告内容。
  };

  // 签发（独立 key + 2-人 ceremony）。
  const signed = await signRegressionTransition(manifest);

  // ★验签（只从受信 regression-transition 公钥集，不信工件自报 keyId）+ re-assert purpose + 方向。
  const verify = await verifyRegressionTransition(signed.keyId, signed.canonicalPayloadB64url, signed.signature);
  if (verify.status !== 'verified') {
    throw new Error(`manifest_verify_failed: ${verify.status} (${verify.reason ?? '-'})`);
  }
  // verify 通过后交叉核对 manifest 的方向与请求一致（防 signing-api 返回不相关字节）。
  if (
    verify.manifest?.baselineToolchainId !== baselineToolchainId ||
    verify.manifest?.currentToolchainId !== currentToolchainId
  ) {
    throw new Error('manifest_mismatch: signed toolchain pair does not match requested transition');
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
 * ★读路径：从**未撤销、未过期**的 upgrade-manifest 动态派生一份报告的 transition 证据（不 mutate 报告行）。
 * 有活跃 manifest → { manifestHash, transitionVerified:true }；无 → { null, null }。多条时取最近批准的一条
 * （active partial-unique 已保证同 (report,X,Y) 至多一条活跃；跨 transition 可能多条，取最新 approvedAt）。
 * ★这只是**证据**——消费端（signability 派生）绝不因它移除 TOOLCHAIN_PROVENANCE_UNVERIFIED（层5≠层3）。
 */
export async function deriveReportTransitionEvidence(
  reportId: string,
  now: Date = new Date(),
): Promise<ReportTransitionEvidence> {
  const rows = await db
    .select()
    .from(regressionUpgradeManifests)
    .where(and(eq(regressionUpgradeManifests.reportId, reportId), isNull(regressionUpgradeManifests.revokedAt)));
  const active = rows
    .filter((m) => m.expiresAt.getTime() > now.getTime())
    .sort((a, b) => b.approvedAt.getTime() - a.approvedAt.getTime());
  if (active.length === 0) {
    return { approvedTransitionManifestHash: null, transitionVerified: null };
  }
  return { approvedTransitionManifestHash: active[0].manifestHash, transitionVerified: true };
}
