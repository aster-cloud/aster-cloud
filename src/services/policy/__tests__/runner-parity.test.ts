import { describe, it, expect } from 'vitest';
import { runRunnerParityCheck } from '../runner-parity';

const AUTH = {
  canonicalInputHash: 'i', canonicalOutputHash: 'o',
  canonicalizationVersion: 'v1', replayabilityStatus: 'REPLAYABLE', traceHash: 't',
  runtimeToolchainId: 'aster-api-build',
};

const PARAMS = {
  tenantId: 't', actorUserId: 'u', source: 's', input: {}, locale: 'en-US',
  functionName: 'f', aliasSet: null, role: 'ADMIN',
};

describe('runRunnerParityCheck', () => {
  // ★用 deps 注入 seam 桩（Codex 抓——不 spy 同模块词法绑定，ESM 下无效）。

  it('两路成功且 5 字段一致（runtimeToolchainId 不同也 match）→ match', async () => {
    const r = await runRunnerParityCheck(PARAMS, {
      authority: async () => AUTH,
      launch: async () => ({ ok: true, replayMetadata: { ...AUTH, runtimeToolchainId: 'runner-build-DIFFERENT' } }),
    });
    expect(r.status).toBe('match');
  });

  it('5 字段之一分叉 → divergent + divergentFields', async () => {
    const r = await runRunnerParityCheck(PARAMS, {
      authority: async () => AUTH,
      launch: async () => ({ ok: true, replayMetadata: { ...AUTH, traceHash: 'DIFFERENT' } }),
    });
    expect(r.status).toBe('divergent');
    if (r.status === 'divergent') expect(r.divergentFields).toContain('traceHash');
  });

  it('runner 不可达 → runner-unavailable（权威侧照常, 不抛）', async () => {
    const r = await runRunnerParityCheck(PARAMS, {
      authority: async () => AUTH,
      launch: async () => ({ ok: false, kind: 'unavailable', reason: 'HTTP 503' }),
    });
    expect(r.status).toBe('runner-unavailable');
  });

  it('runner promise reject（未来 launch regress 抛）也归 unavailable（防御性 catch）', async () => {
    const r = await runRunnerParityCheck(PARAMS, {
      authority: async () => AUTH,
      launch: async () => { throw new Error('unexpected throw'); },
    });
    expect(r.status).toBe('runner-unavailable');
  });

  it('权威侧失败 → authority-failure（parity 不可判, 非 runner 错）', async () => {
    const r = await runRunnerParityCheck(PARAMS, {
      authority: async () => { throw new Error('aster-api down'); },
      launch: async () => ({ ok: true, replayMetadata: AUTH }),
    });
    expect(r.status).toBe('authority-failure');
  });

  it('权威侧 200 但缺 metadata → authority-failure（非 match）', async () => {
    const r = await runRunnerParityCheck(PARAMS, {
      authority: async () => ({
        canonicalInputHash: null, canonicalOutputHash: null, canonicalizationVersion: null,
        replayabilityStatus: null, traceHash: null,
      }),
      launch: async () => ({ ok: true, replayMetadata: AUTH }),
    });
    expect(r.status).toBe('authority-failure');
  });
});
