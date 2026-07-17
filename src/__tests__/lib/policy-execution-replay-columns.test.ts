import { describe, it, expect } from 'vitest';
import {
  buildReplayColumns,
  FULL_CAPTURE_PAYLOAD_NOT_CAPTURED_M1,
  REPLAY_MISSING_REASONS,
  type ReplayVersionRefs,
} from '@/lib/policy-execution-log';
import type { PolicyReplayMetadata } from '@/services/policy/policy-api';

/**
 * buildReplayColumns（ADR 0030 附录 A）——Execution 回放列取值语义（M2.1b 后修正）。
 *
 * ★行级 replayabilityStatus 由 gate 判（非恒 NON_REPLAYABLE）：后端 REPLAYABLE **且** freeze 所需字段
 * 全非空白 → REPLAYABLE（有可信「从冻结 input 重求值」的 P0-A 回放路径，M1 run 不读 replayPayload）；
 * 否则 NON_REPLAYABLE + 全部缺项机器码。replayCaptureVersion/replayPayload* 仍 null（M2 完整 capture 才置，
 * 与 replayabilityStatus 是两条独立轴）。缺 replayMetadata → status=null（未捕获 ≠ 已评估但不满足）。
 */
const REFS: ReplayVersionRefs = {
  policyVersionRowId: 'pv_row_123',
  policyVersion: 4,
  sourceToolchainId: 'abi=V1;core=1.0.8;validator=3;build=prod',
  vocabSnapshotRef: [{ snapshotId: 's1', domain: 'finance', locale: 'en-US' }],
  locale: 'en-US',
  aliasSetJson: {},
  functionName: 'approveLoan',
};

// 全字段齐全的后端 REPLAYABLE metadata（gate 全过）。
const REPLAY: PolicyReplayMetadata = {
  runtimeToolchainId: 'abi=V1;core=1.0.8;validator=3;build=prod',
  canonicalizationVersion: 'aster-canonical-json/v1',
  canonicalInputHash: 'aaa',
  canonicalOutputHash: 'bbb',
  traceHash: 'ccc',
  reasonCodes: [],
  replayabilityStatus: 'REPLAYABLE',
  replayabilityReasons: [],
};

describe('buildReplayColumns — 回放列语义（M2.1b 后）', () => {
  it('透传后端权威 hash + 工具链', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.runtimeToolchainId).toBe(REPLAY.runtimeToolchainId);
    expect(cols.canonicalInputHash).toBe('aaa');
    expect(cols.canonicalOutputHash).toBe('bbb');
    expect(cols.traceHash).toBe('ccc');
    expect(cols.canonicalizationVersion).toBe('aster-canonical-json/v1');
  });

  it('★gate 全过 → REPLAYABLE + capture-limitation 诊断（非不可回放原因）', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.replayabilityStatus).toBe('REPLAYABLE');
    // REPLAYABLE 行追加「无 M2 完整 capture」诊断（不是不可回放原因）。
    expect(cols.replayabilityReasons).toContain(FULL_CAPTURE_PAYLOAD_NOT_CAPTURED_M1);
    // 后端原状态保留追溯。
    expect(cols.replayabilityReasons).toContain('backend_status=REPLAYABLE');
  });

  it('★后端 NON_REPLAYABLE（即使其它字段齐全）→ NON_REPLAYABLE + BACKEND_STATUS_NOT_REPLAYABLE', () => {
    const cols = buildReplayColumns({ ...REPLAY, replayabilityStatus: 'NON_REPLAYABLE' }, REFS);
    expect(cols.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(cols.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.BACKEND_STATUS_NOT_REPLAYABLE);
    expect(cols.replayabilityReasons).not.toContain(FULL_CAPTURE_PAYLOAD_NOT_CAPTURED_M1);
  });

  it('★后端 REPLAYABLE 但缺 traceHash → NON_REPLAYABLE（挡后端 trace==null 宽松态）', () => {
    const cols = buildReplayColumns({ ...REPLAY, traceHash: null }, REFS);
    expect(cols.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(cols.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_TRACE_HASH);
  });

  it('★缺 canonicalizationVersion → NON_REPLAYABLE（后端 REPLAYABLE 不保证它）', () => {
    const cols = buildReplayColumns({ ...REPLAY, canonicalizationVersion: undefined }, REFS);
    expect(cols.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(cols.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_CANONICALIZATION_VERSION);
  });

  it('★缺 canonicalInput/OutputHash → NON_REPLAYABLE + 对应缺项码', () => {
    const ci = buildReplayColumns({ ...REPLAY, canonicalInputHash: null }, REFS);
    expect(ci.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(ci.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_CANONICAL_INPUT_HASH);
    const co = buildReplayColumns({ ...REPLAY, canonicalOutputHash: null }, REFS);
    expect(co.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(co.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_CANONICAL_OUTPUT_HASH);
  });

  it('★缺 runtime/source toolchain → NON_REPLAYABLE + 对应缺项码', () => {
    const rt = buildReplayColumns({ ...REPLAY, runtimeToolchainId: undefined }, REFS);
    expect(rt.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(rt.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_RUNTIME_TOOLCHAIN_ID);
    const st = buildReplayColumns(REPLAY, { ...REFS, sourceToolchainId: null });
    expect(st.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(st.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_SOURCE_TOOLCHAIN_ID);
  });

  it('★缺 policyVersionRowId/functionName/locale（freeze 硬条件）→ NON_REPLAYABLE + 对应缺项码', () => {
    const pv = buildReplayColumns(REPLAY, { ...REFS, policyVersionRowId: null });
    expect(pv.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(pv.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_POLICY_VERSION_ROW_ID);
    const fn = buildReplayColumns(REPLAY, { ...REFS, functionName: null });
    expect(fn.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(fn.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_FUNCTION_NAME);
    const lc = buildReplayColumns(REPLAY, { ...REFS, locale: null });
    expect(lc.replayabilityStatus).toBe('NON_REPLAYABLE');
    expect(lc.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_LOCALE);
  });

  it('★空白字符串视为缺失（non-blank 校验，防空串/纯空白通过）', () => {
    expect(buildReplayColumns({ ...REPLAY, traceHash: '   ' }, REFS).replayabilityStatus).toBe('NON_REPLAYABLE');
  });

  it('★多缺项：全部缺项码都记（不止第一个）+ 去重', () => {
    const cols = buildReplayColumns({ ...REPLAY, traceHash: null, canonicalizationVersion: undefined }, REFS);
    expect(cols.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_TRACE_HASH);
    expect(cols.replayabilityReasons).toContain(REPLAY_MISSING_REASONS.MISSING_CANONICALIZATION_VERSION);
    // 去重：无重复项。
    const r = cols.replayabilityReasons as string[];
    expect(r.length).toBe(new Set(r).size);
  });

  it('保留后端 reasons（不丢诊断）', () => {
    const withReasons: PolicyReplayMetadata = {
      ...REPLAY,
      replayabilityStatus: 'NON_REPLAYABLE',
      replayabilityReasons: ['input_hash_failed: NaN'],
    };
    const cols = buildReplayColumns(withReasons, REFS);
    expect(cols.replayabilityReasons).toEqual(
      expect.arrayContaining([
        'input_hash_failed: NaN',
        'backend_status=NON_REPLAYABLE',
        REPLAY_MISSING_REASONS.BACKEND_STATUS_NOT_REPLAYABLE,
      ])
    );
    expect(cols.replayabilityStatus).toBe('NON_REPLAYABLE');
  });

  it('★replayCaptureVersion/replayPayload* 恒 null（即使 REPLAYABLE——M2 完整 capture 才落）', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.replayabilityStatus).toBe('REPLAYABLE');
    expect(cols.replayCaptureVersion).toBeNull();
    expect(cols.replayPayloadCiphertext).toBeNull();
    expect(cols.traceJson).toBeNull();
    expect(cols.piiRetentionUntil).toBeNull();
  });

  it('版本引用列不依赖 replayMetadata（总是填）', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.policyVersionRowId).toBe('pv_row_123');
    expect(cols.policyVersion).toBe(4);
    expect(cols.sourceToolchainId).toBe(REFS.sourceToolchainId);
    expect(cols.vocabSnapshotRef).toEqual(REFS.vocabSnapshotRef);
    expect(cols.locale).toBe('en-US');
    expect(cols.functionName).toBe('approveLoan');
  });

  it('★replayMetadata 缺失：status=null（未捕获 ≠ 已评估但不满足），版本引用仍填', () => {
    const cols = buildReplayColumns(undefined, REFS);
    expect(cols.canonicalInputHash).toBeNull();
    expect(cols.traceHash).toBeNull();
    expect(cols.replayabilityStatus).toBeNull();
    expect(cols.replayabilityReasons).toBeNull();
    expect(cols.policyVersionRowId).toBe('pv_row_123');
    expect(cols.policyVersion).toBe(4);
  });

  it('aliasSetJson={} 表示 captured-no-alias（区别于 null=uncaptured）', () => {
    expect(buildReplayColumns(REPLAY, { ...REFS, aliasSetJson: {} }).aliasSetJson).toEqual({});
    expect(buildReplayColumns(REPLAY, { ...REFS, aliasSetJson: null }).aliasSetJson).toBeNull();
  });

  it('reasonCodes：数组透传，非数组落 null', () => {
    expect(buildReplayColumns(REPLAY, REFS).reasonCodes).toEqual([]);
    expect(buildReplayColumns({ ...REPLAY, reasonCodes: undefined }, REFS).reasonCodes).toBeNull();
  });
});
