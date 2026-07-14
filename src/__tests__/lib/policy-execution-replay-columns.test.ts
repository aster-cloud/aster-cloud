import { describe, it, expect } from 'vitest';
import {
  buildReplayColumns,
  REPLAY_PAYLOAD_NOT_CAPTURED_M1,
  type ReplayVersionRefs,
} from '@/lib/policy-execution-log';
import type { PolicyReplayMetadata } from '@/services/policy/policy-api';

/**
 * buildReplayColumns（ADR 0030 附录 A）——Execution 回放列取值的 M1 语义。
 *
 * M1 只落漂移检测地基（canonical hash + 工具链 + status/reasons），不落 trace 明文 payload。
 * 关键不变式（Codex 设计审 #2）：
 *   - replayCaptureVersion 恒 null（不假装完整 capture），否则回归工具误判可回放；
 *   - replayabilityReasons 追加 REPLAY_PAYLOAD_NOT_CAPTURED_M1；
 *   - 版本引用列（policyVersionRowId/sourceToolchainId/vocabSnapshotRef）不依赖 replayMetadata；
 *   - replayMetadata 缺失 → 回放 hash 列全 null，但版本引用仍填，不阻断写入。
 */
const REFS: ReplayVersionRefs = {
  policyVersionRowId: 'pv_row_123',
  sourceToolchainId: 'abi=V1;core=1.0.8;validator=3;build=prod',
  vocabSnapshotRef: [{ snapshotId: 's1', domain: 'finance', locale: 'en-US' }],
  locale: 'en-US',
  aliasSetJson: {},
  functionName: 'approveLoan',
};

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

describe('buildReplayColumns — M1 回放列语义', () => {
  it('有 replayMetadata：透传后端权威 hash + 工具链', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.runtimeToolchainId).toBe(REPLAY.runtimeToolchainId);
    expect(cols.canonicalInputHash).toBe('aaa');
    expect(cols.canonicalOutputHash).toBe('bbb');
    expect(cols.traceHash).toBe('ccc');
    expect(cols.canonicalizationVersion).toBe('aster-canonical-json/v1');
  });

  it('★行级 replayabilityStatus 恒 NON_REPLAYABLE（即使后端报 REPLAYABLE）', () => {
    // Codex 复审 #3：M1 缺 trace payload，行级回放材料不全。后端 REPLAYABLE 只表 hash 地基
    // 完整，不代表行可回放。写 REPLAYABLE 会让回归工具（筛 replayabilityStatus）选中读不到料。
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.replayabilityStatus).toBe('NON_REPLAYABLE');
    // 后端原状态保留进 reasons 供追溯。
    expect(cols.replayabilityReasons).toContain('backend_status=REPLAYABLE');
    // hash 地基完整性仍由 canonical*Hash 表达（不因 status 降级而丢）。
    expect(cols.canonicalInputHash).toBe('aaa');
    expect(cols.canonicalOutputHash).toBe('bbb');
  });

  it('★replayCaptureVersion 恒 null（M1 不假装完整 capture）', () => {
    expect(buildReplayColumns(REPLAY, REFS).replayCaptureVersion).toBeNull();
    // 即使后端说 REPLAYABLE，cloud 侧也不置 replayCaptureVersion（trace payload 未落）。
  });

  it('★replayabilityReasons 追加 REPLAY_PAYLOAD_NOT_CAPTURED_M1', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.replayabilityReasons).toContain(REPLAY_PAYLOAD_NOT_CAPTURED_M1);
  });

  it('保留后端 reasons 并追加 M1 原因（不丢后端诊断）', () => {
    const withReasons: PolicyReplayMetadata = {
      ...REPLAY,
      replayabilityStatus: 'NON_REPLAYABLE',
      replayabilityReasons: ['input_hash_failed: NaN'],
    };
    const cols = buildReplayColumns(withReasons, REFS);
    expect(cols.replayabilityReasons).toEqual(
      expect.arrayContaining([
        'input_hash_failed: NaN',
        REPLAY_PAYLOAD_NOT_CAPTURED_M1,
        'backend_status=NON_REPLAYABLE',
      ])
    );
    // 行级恒 NON_REPLAYABLE。
    expect(cols.replayabilityStatus).toBe('NON_REPLAYABLE');
  });

  it('版本引用列不依赖 replayMetadata（总是填）', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.policyVersionRowId).toBe('pv_row_123');
    expect(cols.sourceToolchainId).toBe(REFS.sourceToolchainId);
    expect(cols.vocabSnapshotRef).toEqual(REFS.vocabSnapshotRef);
    expect(cols.locale).toBe('en-US');
    expect(cols.functionName).toBe('approveLoan');
  });

  it('replayMetadata 缺失：hash 列全 null 但版本引用仍填（不阻断写入）', () => {
    const cols = buildReplayColumns(undefined, REFS);
    expect(cols.canonicalInputHash).toBeNull();
    expect(cols.canonicalOutputHash).toBeNull();
    expect(cols.traceHash).toBeNull();
    expect(cols.runtimeToolchainId).toBeNull();
    expect(cols.replayabilityStatus).toBeNull();
    expect(cols.replayabilityReasons).toBeNull();
    // 版本引用不受影响。
    expect(cols.policyVersionRowId).toBe('pv_row_123');
    expect(cols.sourceToolchainId).toBe(REFS.sourceToolchainId);
  });

  it('aliasSetJson={} 表示 captured-no-alias（区别于 null=uncaptured）', () => {
    const captured = buildReplayColumns(REPLAY, { ...REFS, aliasSetJson: {} });
    expect(captured.aliasSetJson).toEqual({});
    const uncaptured = buildReplayColumns(REPLAY, { ...REFS, aliasSetJson: null });
    expect(uncaptured.aliasSetJson).toBeNull();
  });

  it('M1 payload/pii 列全 null（trace 明文 + envelope 待 M2）', () => {
    const cols = buildReplayColumns(REPLAY, REFS);
    expect(cols.traceJson).toBeNull();
    expect(cols.replayPayloadCiphertext).toBeNull();
    expect(cols.replayPayloadAlg).toBeNull();
    expect(cols.replayPayloadKeyId).toBeNull();
    expect(cols.replayPayloadNonce).toBeNull();
    expect(cols.replayPayloadHash).toBeNull();
    expect(cols.piiRetentionUntil).toBeNull();
    expect(cols.piiPolicyVersion).toBeNull();
  });

  it('reasonCodes：数组透传，非数组落 null', () => {
    expect(buildReplayColumns(REPLAY, REFS).reasonCodes).toEqual([]);
    const badReasons = { ...REPLAY, reasonCodes: undefined };
    expect(buildReplayColumns(badReasons, REFS).reasonCodes).toBeNull();
  });
});
