// 证据包组装纯函数单测（无 DB）。重点：bundleHash 确定性——这是审计物防篡改的基石。

import { describe, it, expect } from 'vitest';
import {
  buildEvidenceEntry,
  buildBundle,
  buildManifest,
  computeBundleHash,
  serializeBundle,
  tallyDecisions,
  type EvidenceRow,
} from '@/services/evidence/bundle';
import { CANONICALIZATION_VERSION } from '@/lib/canonical-json';
import type { EvidenceEntry } from '@/services/evidence/types';

function row(over: Partial<EvidenceRow> = {}): EvidenceRow {
  // 用 'key' in over 区分「未传」与「显式 null」——?? 会把显式 null 折叠成默认值（本测试早期 bug）。
  return {
    id: over.id ?? 'exec-1',
    policyId: over.policyId ?? 'pol-1',
    policyVersion: over.policyVersion ?? 3,
    policyVersionRowId: over.policyVersionRowId ?? 'pv-1',
    decision: 'decision' in over ? over.decision! : 'approved',
    canonicalInputHash: 'canonicalInputHash' in over ? over.canonicalInputHash! : 'in-hash',
    canonicalOutputHash: 'canonicalOutputHash' in over ? over.canonicalOutputHash! : 'out-hash',
    traceHash: over.traceHash ?? 'trace-hash',
    canonicalizationVersion: over.canonicalizationVersion ?? CANONICALIZATION_VERSION,
    sourceToolchainId: over.sourceToolchainId ?? 'tc-src',
    runtimeToolchainId: over.runtimeToolchainId ?? 'tc-run',
    replayabilityStatus: over.replayabilityStatus ?? 'REPLAYABLE',
    replayabilityReasons: over.replayabilityReasons ?? null,
    reasonCodes: over.reasonCodes ?? null,
    source: over.source ?? 'api',
    durationMs: over.durationMs ?? 12,
    createdAt: over.createdAt ?? new Date('2026-07-01T00:00:00Z'),
  };
}

const policy = { id: 'pol-1', name: 'Loan', version: 3, policyVersionRowId: 'pv-1' } as const;
const gen = new Date('2026-07-16T00:00:00Z');
const range = { start: new Date('2026-06-01T00:00:00Z'), end: new Date('2026-07-01T00:00:00Z') };

describe('buildEvidenceEntry', () => {
  it('映射哈希/溯源字段，createdAt 转 ISO，不含明文 input/output', () => {
    const e = buildEvidenceEntry(row());
    expect(e).toMatchObject({
      executionId: 'exec-1',
      decision: 'approved',
      canonicalInputHash: 'in-hash',
      canonicalOutputHash: 'out-hash',
      traceHash: 'trace-hash',
      toolchain: { source: 'tc-src', runtime: 'tc-run' },
      createdAt: '2026-07-01T00:00:00.000Z',
    });
    // 绝不出现明文数据字段
    expect(JSON.stringify(e)).not.toContain('traceJson');
    expect(e).not.toHaveProperty('input');
    expect(e).not.toHaveProperty('output');
  });
});

describe('tallyDecisions', () => {
  it('统计各态；decision=null 计入 unknown', () => {
    const entries = [
      buildEvidenceEntry(row({ id: 'a', decision: 'approved' })),
      buildEvidenceEntry(row({ id: 'b', decision: 'denied' })),
      buildEvidenceEntry(row({ id: 'c', decision: null })),
      buildEvidenceEntry(row({ id: 'd', decision: 'error' })),
    ];
    expect(tallyDecisions(entries)).toEqual({ approved: 1, denied: 1, indeterminate: 0, error: 1, unknown: 1 });
  });
});

describe('computeBundleHash 确定性', () => {
  const eA = buildEvidenceEntry(row({ id: 'a', createdAt: new Date('2026-07-01T00:00:00Z') }));
  const eB = buildEvidenceEntry(row({ id: 'b', createdAt: new Date('2026-07-02T00:00:00Z') }));

  it('★任意输入顺序 → 同 bundleHash（内部按 createdAt,id 排序）', () => {
    expect(computeBundleHash([eA, eB])).toBe(computeBundleHash([eB, eA]));
  });

  it('★改任一 entry 的哈希 → bundleHash 变', () => {
    const base = computeBundleHash([eA, eB]);
    const tampered = buildEvidenceEntry(row({ id: 'a', canonicalOutputHash: 'DIFFERENT' }));
    expect(computeBundleHash([tampered, eB])).not.toBe(base);
  });

  it('★改 decision → bundleHash 变', () => {
    const base = computeBundleHash([eA, eB]);
    const flipped = buildEvidenceEntry(row({ id: 'a', decision: 'denied' }));
    expect(computeBundleHash([flipped, eB])).not.toBe(base);
  });

  it('空 entries → 稳定哈希（对 [] 的 canonicalHash）', () => {
    expect(computeBundleHash([])).toBe(computeBundleHash([]));
  });
});

describe('buildManifest', () => {
  it('汇总 count/tally/range/version + legacy 缺哈希计数', () => {
    const entries = [
      buildEvidenceEntry(row({ id: 'a', decision: 'approved' })),
      // legacy 行：无 canonical 哈希 + decision=null
      buildEvidenceEntry(row({ id: 'b', canonicalInputHash: null, canonicalOutputHash: null, decision: null })),
    ];
    const m = buildManifest({ policy, range, entries, generatedAt: gen });
    expect(m.totals.count).toBe(2);
    expect(m.decisionTally.approved).toBe(1);
    expect(m.decisionTally.unknown).toBe(1);
    expect(m.notes.legacyRowsWithoutHashes).toBe(1);
    expect(m.canonicalizationVersion).toBe(CANONICALIZATION_VERSION);
    expect(m.kind).toBe('evidence-export');
    expect(m.range.start).toBe('2026-06-01T00:00:00.000Z');
  });

  it('scope=all 策略快照', () => {
    const m = buildManifest({ policy: { scope: 'all' }, range, entries: [], generatedAt: gen });
    expect(m.policy).toEqual({ scope: 'all' });
    expect(m.totals.count).toBe(0);
  });
});

describe('serializeBundle', () => {
  const bundle = buildBundle({
    policy,
    range,
    entries: [buildEvidenceEntry(row({ id: 'a' })), buildEvidenceEntry(row({ id: 'b', createdAt: new Date('2026-07-02T00:00:00Z') }))],
    generatedAt: gen,
  });

  it('json：可解析回 { manifest, entries }', () => {
    const parsed = JSON.parse(serializeBundle(bundle, 'json'));
    expect(parsed.manifest.kind).toBe('evidence-export');
    expect(parsed.entries).toHaveLength(2);
  });

  it('★jsonl：首行 _manifest + 每行一 entry（行数 = entries + 1）', () => {
    const lines = serializeBundle(bundle, 'jsonl').trim().split('\n');
    expect(lines).toHaveLength(3); // manifest + 2 entries
    expect(JSON.parse(lines[0])._manifest.kind).toBe('evidence-export');
    expect(JSON.parse(lines[1]).executionId).toBeDefined();
  });
});

describe('bundleHash 版本前缀', () => {
  it('bundleHash 是 hex（复用 canonicalHash：带 CANONICALIZATION_VERSION 前缀的 sha256）', () => {
    const entries: EvidenceEntry[] = [buildEvidenceEntry(row())];
    const m = buildManifest({ policy, range, entries, generatedAt: gen });
    expect(m.bundleHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
