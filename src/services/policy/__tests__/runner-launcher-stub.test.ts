import { describe, it, expect, beforeEach } from 'vitest';
import { signRunnerLauncherHeaders } from '../../../lib/api-signing';
import { launchRunnerJob } from '../runner-launcher-client';
import { handleRunnerLaunch, __setStubReplayMetadata } from '../runner-launcher-stub';

const RM = { canonicalInputHash: 'i', canonicalOutputHash: 'o', canonicalizationVersion: 'v1', replayabilityStatus: 'REPLAYABLE', traceHash: 't' };

describe('runner-launcher stub（真验 HMAC）', () => {
  beforeEach(() => {
    process.env.ASTER_RUNNER_LAUNCHER_HMAC_KEY = 'k';
    __setStubReplayMetadata(RM);
  });

  it('合法 HMAC → 200 SUCCESS envelope', async () => {
    const body = JSON.stringify({ tenantId: 't', source: 's', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null });
    const headers = await signRunnerLauncherHeaders('POST', '/api/v1/runner/launch', body, 't', 'ADMIN');
    const resp = await handleRunnerLaunch(new Request('https://x/api/v1/runner/launch', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body }));
    expect(resp.status).toBe(200);
    const env = await resp.json();
    expect(env.outcome).toBe('SUCCESS');
    expect(env.replayMetadata.canonicalInputHash).toBe('i');
  });

  it('★错误 key 签名 → 4xx 拒（验密钥隔离真工作）', async () => {
    const body = '{}';
    // 用错 key 签
    process.env.ASTER_RUNNER_LAUNCHER_HMAC_KEY = 'WRONG';
    const headers = await signRunnerLauncherHeaders('POST', '/api/v1/runner/launch', body, 't', 'r');
    process.env.ASTER_RUNNER_LAUNCHER_HMAC_KEY = 'k'; // stub 验签用的真 key
    const resp = await handleRunnerLaunch(new Request('https://x/api/v1/runner/launch', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body }));
    expect(resp.status).toBeGreaterThanOrEqual(400);
    expect(resp.status).toBeLessThan(500);
  });

  it('无签名头 → 4xx', async () => {
    const resp = await handleRunnerLaunch(new Request('https://x/api/v1/runner/launch', { method: 'POST', body: '{}' }));
    expect(resp.status).toBeGreaterThanOrEqual(400);
  });

  it('★全链集成：client 签名（launchRunnerJob）→ stub 真验通过，收到 ReplayMetadata（验独立 HMAC key 端到端接通）', async () => {
    process.env.ASTER_RUNNER_LAUNCHER_URL = 'https://launcher.test';
    const originalFetch = global.fetch;
    // ★用 fetch mock 把 client 的出站请求直接路由到 stub handler（同进程内验证 canonical
    //   逐字节一致，无需起真 HTTP server）——client（Task 1/2）签名 → stub（本任务）验签。
    global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const req = input instanceof Request ? input : new Request(input, init);
      return handleRunnerLaunch(req);
    }) as typeof fetch;
    try {
      const result = await launchRunnerJob({
        tenantId: 't', source: 's', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null, role: 'ADMIN',
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.replayMetadata.canonicalInputHash).toBe('i');
        expect(result.replayMetadata.replayabilityStatus).toBe('REPLAYABLE');
      }
    } finally {
      global.fetch = originalFetch;
    }
  });
});
