import { describe, it, expect, beforeEach, vi } from 'vitest';
import { launchRunnerJob } from '../runner-launcher-client';

describe('launchRunnerJob', () => {
  beforeEach(() => {
    process.env.ASTER_RUNNER_LAUNCHER_HMAC_KEY = 'k';
    process.env.ASTER_RUNNER_LAUNCHER_URL = 'https://launcher.test';
  });

  it('成功响应（outcome SUCCESS 200）→ {ok:true, replayMetadata}', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      outcome: 'SUCCESS',
      replayMetadata: { canonicalInputHash: 'i', canonicalOutputHash: 'o',
        canonicalizationVersion: 'v1', replayabilityStatus: 'REPLAYABLE', traceHash: 't' },
    }), { status: 200 }));
    const r = await launchRunnerJob({ tenantId: 't', source: 's', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null, role: 'ADMIN' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.replayMetadata.canonicalInputHash).toBe('i');
  });

  it('runner 业务错（outcome ERROR 200）→ {ok:false, kind:runner-error}（按 outcome 非 HTTP status）', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      outcome: 'ERROR', errorCode: 'MODULE', message: 'boom', phase: 'execute' }), { status: 200 }));
    const r = await launchRunnerJob({ tenantId: 't', source: 's', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null, role: 'ADMIN' });
    expect(r.ok).toBe(false);
    // ★用 if (kind==='runner-error') 而非 expect().toBe() 收窄——后者不是类型守卫，
    //   tsc --strict 下访问 r.errorCode 会报"不存在于 unavailable 分支"。
    if (!r.ok && r.kind === 'runner-error') { expect(r.errorCode).toBe('MODULE'); }
    else { throw new Error('expected kind=runner-error'); }
  });

  it('HTTP 非 200 / 网络错 → {ok:false, kind:unavailable}', async () => {
    global.fetch = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
    const r = await launchRunnerJob({ tenantId: 't', source: 's', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null, role: 'ADMIN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unavailable');
  });

  it('超时（AbortError）→ unavailable，不抛', async () => {
    global.fetch = vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const r = await launchRunnerJob({ tenantId: 't', source: 's', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null, role: 'ADMIN' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.kind).toBe('unavailable');
  });
});
