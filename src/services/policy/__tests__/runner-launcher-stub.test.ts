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

  it('★篡改 body（签名后改 body）→ 403（HMAC 验证捕获）', async () => {
    const body = JSON.stringify({ tenantId: 't', source: 's', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null });
    const headers = await signRunnerLauncherHeaders('POST', '/api/v1/runner/launch', body, 't', 'ADMIN');
    // 用合法签名头但发送被篡改的 body → canonical 的 bodyHash 不匹配 → 验签失败
    const tamperedBody = JSON.stringify({ tenantId: 't', source: 'TAMPERED', input: {}, locale: 'en-US', functionName: 'f', aliasSet: null });
    const resp = await handleRunnerLaunch(new Request('https://x/api/v1/runner/launch', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: tamperedBody }));
    expect(resp.status).toBe(403);
  });

  it('★篡改 tenant header（签名后改 X-Aster-Tenant）→ 403（绑定字段篡改捕获）', async () => {
    const body = '{}';
    const headers = await signRunnerLauncherHeaders('POST', '/api/v1/runner/launch', body, 't', 'ADMIN');
    // 改 X-Aster-Tenant → stub 用改后的 tenant 重建 canonical，与签名时的 tenant 不符 → 验签失败
    const resp = await handleRunnerLaunch(new Request('https://x/api/v1/runner/launch', { method: 'POST', headers: { ...headers, 'X-Aster-Tenant': 'OTHER-TENANT', 'Content-Type': 'application/json' }, body }));
    expect(resp.status).toBe(403);
  });

  it('★过期时间戳（>5min）→ 401', async () => {
    const body = '{}';
    const headers = await signRunnerLauncherHeaders('POST', '/api/v1/runner/launch', body, 't', 'ADMIN');
    // 覆盖时间戳为 10 分钟前 → 过期窗口
    const staleTs = (Math.floor(Date.now() / 1000) - 600).toString();
    const resp = await handleRunnerLaunch(new Request('https://x/api/v1/runner/launch', { method: 'POST', headers: { ...headers, 'X-Aster-Timestamp': staleTs, 'Content-Type': 'application/json' }, body }));
    expect(resp.status).toBe(401);
  });

  it('★非数字时间戳 → 401（不因 NaN 误放行）', async () => {
    const body = '{}';
    const headers = await signRunnerLauncherHeaders('POST', '/api/v1/runner/launch', body, 't', 'ADMIN');
    const resp = await handleRunnerLaunch(new Request('https://x/api/v1/runner/launch', { method: 'POST', headers: { ...headers, 'X-Aster-Timestamp': 'not-a-number', 'Content-Type': 'application/json' }, body }));
    expect(resp.status).toBe(401);
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
