/*
 * runner-parity 接线（maybeRunParityForExecution）测试：mode 分派 + 采样 + 不双评估 + 失败隔离 + 回写。
 * ★铁律：任何失败绝不冒泡（log-only）；side-A 注入不重跑 aster-api。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mock 依赖（vi.hoisted：mock 工厂被提升到 import 之上，不能闭包后声明的 const）──
const { getRunnerParityConfig, runRunnerParityCheck, dbUpdateSet, dbUpdate } = vi.hoisted(() => {
  const dbUpdateSet = vi.fn();
  const dbUpdate = vi.fn(() => ({ set: dbUpdateSet }));
  return {
    getRunnerParityConfig: vi.fn(),
    runRunnerParityCheck: vi.fn(),
    dbUpdateSet,
    dbUpdate,
  };
});

vi.mock('@/lib/platform-settings', () => ({ getRunnerParityConfig }));
vi.mock('@/lib/prisma', () => ({ db: { update: dbUpdate }, executions: { id: 'id' } }));
vi.mock('../runner-parity', () => ({ runRunnerParityCheck }));
vi.mock('drizzle-orm', () => ({ and: (...a: unknown[]) => a, eq: (c: unknown, v: unknown) => ({ c, v }) }));

import { maybeRunParityForExecution, runParityForExecutionNow } from '../runner-parity-from-execution';

const baseCtx = {
  executionId: 'exec-1',
  tenantId: 't1',
  actorUserId: 'u1',
  source: 'Rule x is 1.',
  input: { a: 1 } as Record<string, unknown>,
  locale: 'en',
  functionName: 'x',
  aliasSet: null,
  role: 'ADMIN',
  authorityReplay: {
    canonicalInputHash: 'in', canonicalOutputHash: 'out', canonicalizationVersion: 'v1',
    replayabilityStatus: 'REPLAYABLE', traceHash: 'th', runtimeToolchainId: 'tc',
  },
};

// db.update(...).set(...).where(...).returning(...) 链——returning 默认返 1 行（=persisted）。
function mockUpdateReturning(returning: unknown[] | (() => Promise<unknown[]>)) {
  const returningFn = typeof returning === 'function'
    ? vi.fn(returning)
    : vi.fn().mockResolvedValue(returning);
  dbUpdateSet.mockReturnValue({ where: vi.fn().mockReturnValue({ returning: returningFn }) });
  dbUpdate.mockReturnValue({ set: dbUpdateSet });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUpdateReturning([{ id: 'exec-1' }]); // 默认 1 行更新 = persisted
  runRunnerParityCheck.mockResolvedValue({ status: 'match' });
});

describe('maybeRunParityForExecution — mode 分派', () => {
  it('off → skip（不跑、返回 null）', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'off', samplePct: 100 });
    expect(await maybeRunParityForExecution(baseCtx)).toBeNull();
    expect(runRunnerParityCheck).not.toHaveBeenCalled();
  });

  it('manual → skip（自动路径不跑；仅显式 endpoint 触发）', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'manual', samplePct: 100 });
    expect(await maybeRunParityForExecution(baseCtx)).toBeNull();
    expect(runRunnerParityCheck).not.toHaveBeenCalled();
  });

  it('every → 跑并回写', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    const r = await maybeRunParityForExecution(baseCtx);
    expect(r).toEqual({ status: 'match' });
    expect(runRunnerParityCheck).toHaveBeenCalledOnce();
    expect(dbUpdate).toHaveBeenCalledOnce(); // 回写 execution 行
  });

  it('sampled + rng 命中（< pct）→ 跑', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'sampled', samplePct: 50 });
    await maybeRunParityForExecution({ ...baseCtx, rng: () => 0.1 }); // 0.1*100=10 < 50 → 命中
    expect(runRunnerParityCheck).toHaveBeenCalledOnce();
  });

  it('sampled + rng 未命中（>= pct）→ skip', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'sampled', samplePct: 50 });
    const r = await maybeRunParityForExecution({ ...baseCtx, rng: () => 0.9 }); // 90 >= 50 → 未命中
    expect(r).toBeNull();
    expect(runRunnerParityCheck).not.toHaveBeenCalled();
  });

  it('sampled samplePct=0 → 恒不命中', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'sampled', samplePct: 0 });
    expect(await maybeRunParityForExecution({ ...baseCtx, rng: () => 0 })).toBeNull(); // 0>=0 → 未命中
    expect(runRunnerParityCheck).not.toHaveBeenCalled();
  });

  it('sampled samplePct=100 → 恒命中（Codex 补）', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'sampled', samplePct: 100 });
    // rng 返回接近 1 的最大值：0.999*100=99.9 < 100 → 仍命中。
    await maybeRunParityForExecution({ ...baseCtx, rng: () => 0.999 });
    expect(runRunnerParityCheck).toHaveBeenCalledOnce();
  });
});

describe('maybeRunParityForExecution — 不双评估（注入 side-A）', () => {
  it('传给 runRunnerParityCheck 的 deps.authority 返回注入的 authorityReplay（不重跑 aster-api）', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    await maybeRunParityForExecution(baseCtx);
    const [, deps] = runRunnerParityCheck.mock.calls[0];
    expect(deps).toHaveProperty('authority');
    const injected = await deps.authority();
    // 注入的 side-A == baseCtx.authorityReplay 归一化后的 5 字段
    expect(injected.canonicalInputHash).toBe('in');
    expect(injected.traceHash).toBe('th');
  });

  it('authorityReplay=undefined → 归一化为全 null（parity 层判 authority-failure）', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    await maybeRunParityForExecution({ ...baseCtx, authorityReplay: undefined });
    const [, deps] = runRunnerParityCheck.mock.calls[0];
    const injected = await deps.authority();
    expect(injected.canonicalInputHash).toBeNull();
    expect(injected.canonicalOutputHash).toBeNull();
  });
});

describe('maybeRunParityForExecution — 失败隔离（铁律：绝不冒泡）', () => {
  it('getRunnerParityConfig 抛 → 吞掉返回 null', async () => {
    getRunnerParityConfig.mockRejectedValue(new Error('db down'));
    await expect(maybeRunParityForExecution(baseCtx)).resolves.toBeNull();
  });

  it('runRunnerParityCheck 抛 → 吞掉返回 null', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    runRunnerParityCheck.mockRejectedValue(new Error('boom'));
    await expect(maybeRunParityForExecution(baseCtx)).resolves.toBeNull();
  });

  it('回写 DB 抛 → 吞掉（parity 结果仍返回，不冒泡）', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    runRunnerParityCheck.mockResolvedValue({ status: 'divergent', divergentFields: ['traceHash'] });
    mockUpdateReturning(() => Promise.reject(new Error("update fail")));
    // 回写失败被 persist 内部吞掉；maybeRun 仍返回结果（不 null，因跑成功了）。
    await expect(maybeRunParityForExecution(baseCtx)).resolves.toEqual({ status: 'divergent', divergentFields: ['traceHash'] });
  });
});

describe('回写列映射', () => {
  it('divergent → 写 status + divergentFields', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    runRunnerParityCheck.mockResolvedValue({ status: 'divergent', divergentFields: ['canonicalOutputHash', 'traceHash'] });
    await maybeRunParityForExecution(baseCtx);
    const setArg = dbUpdateSet.mock.calls[0][0];
    expect(setArg.runnerParityStatus).toBe('divergent');
    expect(setArg.runnerParityDivergentFields).toEqual(['canonicalOutputHash', 'traceHash']);
    expect(setArg.runnerParityCheckedAt).toBeInstanceOf(Date);
  });

  it('match → status=match, divergentFields=null', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    runRunnerParityCheck.mockResolvedValue({ status: 'match' });
    await maybeRunParityForExecution(baseCtx);
    const setArg = dbUpdateSet.mock.calls[0][0];
    expect(setArg.runnerParityStatus).toBe('match');
    expect(setArg.runnerParityDivergentFields).toBeNull();
  });
});

describe('runParityForExecutionNow（manual 显式路径）无视 flag 直接跑', () => {
  it('不读 flag、直接跑并回写，返回 {result, persisted:true}', async () => {
    runRunnerParityCheck.mockResolvedValue({ status: 'match' });
    const r = await runParityForExecutionNow(baseCtx);
    expect(r).toEqual({ result: { status: 'match' }, persisted: true });
    expect(getRunnerParityConfig).not.toHaveBeenCalled(); // 显式路径不看 flag
    expect(runRunnerParityCheck).toHaveBeenCalledOnce();
    expect(dbUpdate).toHaveBeenCalledOnce();
  });

  it('★回写抛 → persisted:false（manual 路径让持久化失败可见，非静默）', async () => {
    runRunnerParityCheck.mockResolvedValue({ status: 'match' });
    mockUpdateReturning(() => Promise.reject(new Error("update fail")));
    const r = await runParityForExecutionNow(baseCtx);
    expect(r).toEqual({ result: { status: 'match' }, persisted: false });
  });

  it('★回写 0 行（execution 并发删/GC）→ persisted:false（Codex 抓：不抛但影响 0 行）', async () => {
    runRunnerParityCheck.mockResolvedValue({ status: 'match' });
    mockUpdateReturning([]); // returning 返 0 行 = 行不存在
    const r = await runParityForExecutionNow(baseCtx);
    expect(r).toEqual({ result: { status: 'match' }, persisted: false });
  });
});

// ★路由 orchestration 契约（Codex 抓竞态）：parity 必须**链在 execution INSERT 成功之后**，
//   而非与 INSERT 并行——否则 UPDATE 可能先于 INSERT→0 行→结果丢。此处复刻路由的 `executionInsertPromise
//   .then(() => maybeRunParity(...), () => null)` 模式，用 deferred promise 断言时序不变量。
describe('路由 orchestration 时序：parity 链在 execution INSERT 之后', () => {
  function deferred<T>() {
    let resolve!: (v: T) => void, reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
  }

  it('INSERT 未 resolve 前 parity 不启动；INSERT resolve 后才启动', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    const insert = deferred<void>();
    // 复刻路由模式：parityTask 链在 insert 之后。
    const parityTask = insert.promise.then(
      () => maybeRunParityForExecution(baseCtx),
      () => null,
    );
    // INSERT 尚未 resolve → parity 不应启动。
    await Promise.resolve(); await Promise.resolve();
    expect(runRunnerParityCheck).not.toHaveBeenCalled();
    // INSERT resolve → parity 启动。
    insert.resolve();
    await parityTask;
    expect(runRunnerParityCheck).toHaveBeenCalledOnce();
  });

  it('INSERT 失败 → parity 跳过（不启动），链 fulfilled 为 null（不冒泡）', async () => {
    getRunnerParityConfig.mockResolvedValue({ mode: 'every', samplePct: 0 });
    const insert = deferred<void>();
    const parityTask = insert.promise.then(
      () => maybeRunParityForExecution(baseCtx),
      () => null,
    );
    insert.reject(new Error('insert failed'));
    await expect(parityTask).resolves.toBeNull(); // 不 reject
    expect(runRunnerParityCheck).not.toHaveBeenCalled();
  });
});
