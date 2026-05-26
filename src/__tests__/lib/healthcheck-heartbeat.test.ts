// healthcheck-heartbeat 单元测试。
// 关键不变量：
//   1. 环境变量缺失时静默 no-op，不发起任何 fetch
//   2. start / fail 拼接子路径；success 不加后缀
//   3. URL 末尾斜杠被归一化
//   4. fetch 失败永不向上抛错

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordHealthcheckHeartbeat } from '@/lib/healthcheck-heartbeat';

const ENV_NAME = 'TEST_HEALTHCHECK_URL';
const ORIGINAL_FETCH = globalThis.fetch;

describe('recordHealthcheckHeartbeat', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    delete process.env[ENV_NAME];
    globalThis.fetch = ORIGINAL_FETCH;
  });

  it('env 未设置时不调用 fetch', async () => {
    await recordHealthcheckHeartbeat(ENV_NAME, 'success');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('success 事件 ping 根 URL，不加后缀', async () => {
    process.env[ENV_NAME] = 'https://hc-ping.com/abc';
    await recordHealthcheckHeartbeat(ENV_NAME, 'success');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('https://hc-ping.com/abc');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('start 事件追加 /start', async () => {
    process.env[ENV_NAME] = 'https://hc-ping.com/abc';
    await recordHealthcheckHeartbeat(ENV_NAME, 'start');
    expect(fetchMock.mock.calls[0][0]).toBe('https://hc-ping.com/abc/start');
  });

  it('fail 事件追加 /fail', async () => {
    process.env[ENV_NAME] = 'https://hc-ping.com/abc';
    await recordHealthcheckHeartbeat(ENV_NAME, 'fail');
    expect(fetchMock.mock.calls[0][0]).toBe('https://hc-ping.com/abc/fail');
  });

  it('归一化 URL 末尾斜杠', async () => {
    process.env[ENV_NAME] = 'https://hc-ping.com/abc///';
    await recordHealthcheckHeartbeat(ENV_NAME, 'success');
    expect(fetchMock.mock.calls[0][0]).toBe('https://hc-ping.com/abc');
  });

  it('fetch 抛错时不向上抛', async () => {
    process.env[ENV_NAME] = 'https://hc-ping.com/abc';
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    // 不应抛错
    await expect(
      recordHealthcheckHeartbeat(ENV_NAME, 'success'),
    ).resolves.toBeUndefined();
  });

  it('超时（abort 信号触发）不向上抛', async () => {
    process.env[ENV_NAME] = 'https://hc-ping.com/abc';
    // 模拟 fetch 监听 abort 信号；helper 触发 timeout 时应当 reject。
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    await expect(
      recordHealthcheckHeartbeat(ENV_NAME, 'success', { timeoutMs: 10 }),
    ).resolves.toBeUndefined();
  });
});
