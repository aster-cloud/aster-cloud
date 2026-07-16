// 证据包组装（纯函数，无 I/O）。
//
// 纯度纪律镜像 canonical-json.ts：所有函数只做数据变换，无 DB/时钟/随机——便于确定性单测。
// bundleHash 复用 canonicalHash（sha256 + CANONICALIZATION_VERSION 前缀），蹭已验证的 canonical 基建，
// 让审计方能用同一规则跨实现重算校验。

import { canonicalHash, CANONICALIZATION_VERSION } from '@/lib/canonical-json';
import type {
  DecisionTally,
  EvidenceBundle,
  EvidenceDecision,
  EvidenceEntry,
  EvidenceFormat,
  EvidenceManifest,
} from './types';

/** 从执行行装配证据条目所需的最小投影（由查询层提供，见 lib/evidence-export.ts）。 */
export interface EvidenceRow {
  id: string;
  policyId: string;
  policyVersion: number | null;
  policyVersionRowId: string | null;
  decision: EvidenceDecision | null;
  canonicalInputHash: string | null;
  canonicalOutputHash: string | null;
  traceHash: string | null;
  canonicalizationVersion: string | null;
  sourceToolchainId: string | null;
  runtimeToolchainId: string | null;
  replayabilityStatus: string | null;
  replayabilityReasons: unknown;
  reasonCodes: unknown;
  source: EvidenceEntry['source'];
  durationMs: number;
  createdAt: Date;
}

export function buildEvidenceEntry(row: EvidenceRow): EvidenceEntry {
  return {
    executionId: row.id,
    policyId: row.policyId,
    policyVersion: row.policyVersion,
    policyVersionRowId: row.policyVersionRowId,
    decision: row.decision,
    canonicalInputHash: row.canonicalInputHash,
    canonicalOutputHash: row.canonicalOutputHash,
    traceHash: row.traceHash,
    canonicalizationVersion: row.canonicalizationVersion,
    toolchain: { source: row.sourceToolchainId, runtime: row.runtimeToolchainId },
    replayabilityStatus: row.replayabilityStatus,
    replayabilityReasons: row.replayabilityReasons ?? null,
    reasonCodes: row.reasonCodes ?? null,
    source: row.source,
    durationMs: row.durationMs,
    createdAt: row.createdAt.toISOString(),
  };
}

const EMPTY_TALLY: DecisionTally = {
  approved: 0,
  denied: 0,
  indeterminate: 0,
  error: 0,
  unknown: 0,
};

/** 统计 decision 分布；decision=null（legacy）计入 unknown 桶。 */
export function tallyDecisions(entries: readonly { decision: EvidenceDecision | null }[]): DecisionTally {
  const tally: DecisionTally = { ...EMPTY_TALLY };
  for (const e of entries) {
    const key: keyof DecisionTally = e.decision ?? 'unknown';
    tally[key] += 1;
  }
  return tally;
}

/**
 * 排序 entries：按 (createdAt, executionId) 升序——bundleHash 确定性的前提（同一批数据任意输入序 → 同 hash）。
 * 返回新数组，不改入参。
 */
export function sortEntries(entries: readonly EvidenceEntry[]): EvidenceEntry[] {
  return [...entries].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
    return a.executionId < b.executionId ? -1 : a.executionId > b.executionId ? 1 : 0;
  });
}

/**
 * 计算 bundleHash：对**有序 entries** 的 canonicalHash（不含 manifest，避免自引用）。
 * 入参会被先排序，保证与输入顺序无关。
 */
export function computeBundleHash(entries: readonly EvidenceEntry[]): string {
  return canonicalHash(sortEntries(entries) as unknown[]);
}

export interface BuildManifestInput {
  policy: EvidenceManifest['policy'];
  range: { start: Date | null; end: Date | null };
  entries: EvidenceEntry[];
  generatedAt: Date;
}

export function buildManifest(input: BuildManifestInput): EvidenceManifest {
  const sorted = sortEntries(input.entries);
  const legacyRowsWithoutHashes = sorted.filter(
    (e) => e.canonicalInputHash == null && e.canonicalOutputHash == null,
  ).length;
  return {
    kind: 'evidence-export',
    schemaVersion: '1',
    generatedAt: input.generatedAt.toISOString(),
    policy: input.policy,
    range: {
      start: input.range.start ? input.range.start.toISOString() : null,
      end: input.range.end ? input.range.end.toISOString() : null,
    },
    totals: { count: sorted.length },
    decisionTally: tallyDecisions(sorted),
    canonicalizationVersion: CANONICALIZATION_VERSION,
    bundleHash: computeBundleHash(sorted),
    notes: {
      legacyRowsWithoutHashes,
      verification:
        'bundleHash = canonicalHash(entries sorted by [createdAt, executionId]); ' +
        'recompute with the same canonical-json rules to verify tamper-evidence.',
    },
  };
}

/** 组装完整 bundle（manifest + 有序 entries）。 */
export function buildBundle(input: BuildManifestInput): EvidenceBundle {
  const entries = sortEntries(input.entries);
  return { manifest: buildManifest({ ...input, entries }), entries };
}

/**
 * 序列化 bundle：
 *   - json：pretty JSON（{ manifest, entries }）。
 *   - jsonl：每行一个 JSON 对象——首行 { _manifest }，其后每行一个 entry（流式友好）。
 */
export function serializeBundle(bundle: EvidenceBundle, format: EvidenceFormat): string {
  if (format === 'jsonl') {
    const lines = [JSON.stringify({ _manifest: bundle.manifest })];
    for (const e of bundle.entries) lines.push(JSON.stringify(e));
    return lines.join('\n') + '\n';
  }
  return JSON.stringify(bundle, null, 2);
}
