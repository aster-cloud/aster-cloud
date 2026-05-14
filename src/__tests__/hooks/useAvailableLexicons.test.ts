/**
 * useAvailableLexicons hook 测试。
 *
 * 重点覆盖 M2 fix：snapshot 失败时**不**翻 loading=false，避免 LanguageSwitcher
 * 误把空列表当成"后端只剩 en"的事实而强制降级用户。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, StrictMode, type ReactNode } from 'react';
import { useAvailableLexicons } from '@/hooks/useAvailableLexicons';

// 把 EventSource mock 成永不连接成功的 stub —— 仅观察 hook 状态机
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
  }
  // helpers
  pushMessage(data: string) {
    this.onmessage?.({ data });
  }
  triggerOpen() {
    this.onopen?.();
  }
  triggerError() {
    this.onerror?.();
  }
}

describe('useAvailableLexicons', () => {
  let originalEventSource: typeof globalThis.EventSource;
  let originalFetch: typeof globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    originalFetch = globalThis.fetch;
    // @ts-expect-error EventSource shim
    globalThis.EventSource = FakeEventSource;
    FakeEventSource.instances = [];
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    // R3：直接赋值 globals 不被 restoreAllMocks 自动恢复，必须手动还原
    globalThis.EventSource = originalEventSource;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('snapshot 成功时 loading 翻 false，lexicons 填充', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: 'en-US', name: 'English', direction: 'ltr' },
        { id: 'zh-CN', name: '中文', direction: 'ltr' },
      ],
    });
    const { result } = renderHook(() => useAvailableLexicons());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.lexicons).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it('M2: snapshot 失败 + SSE 未连接 → loading 保持 true（不强制降级）', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const { result } = renderHook(() => useAvailableLexicons());

    // 给 effect + microtask 一个 tick
    await waitFor(() => {
      expect(result.current.error).toMatch(/network down/);
    });
    // 关键不变式：loading 仍为 true，lexicons 仍为空数组（消费者据此判定"尚未知"）
    expect(result.current.loading).toBe(true);
    expect(result.current.lexicons).toEqual([]);
  });

  it('M2: snapshot 失败后 SSE 第一帧到达 → loading 翻 false', async () => {
    fetchMock.mockRejectedValueOnce(new Error('temporary network blip'));
    const { result } = renderHook(() => useAvailableLexicons());

    await waitFor(() => {
      expect(result.current.error).toMatch(/temporary network blip/);
    });
    expect(result.current.loading).toBe(true);

    // SSE 上来后才解锁
    const es = FakeEventSource.instances[0];
    expect(es).toBeDefined();
    await act(async () => {
      es.triggerOpen();
      es.pushMessage(JSON.stringify([
        { id: 'en-US', name: 'English', direction: 'ltr' },
      ]));
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.lexicons).toHaveLength(1);
    expect(result.current.connected).toBe(true);
  });

  it('heartbeat 帧被静默丢弃，不污染 lexicons', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'en-US', name: 'English', direction: 'ltr' }],
    });
    const { result } = renderHook(() => useAvailableLexicons());
    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    const before = result.current.lexicons;

    const es = FakeEventSource.instances[0];
    await act(async () => {
      es.pushMessage('"heartbeat"');
      es.pushMessage('heartbeat');
    });

    // 没有 react state 改动 —— lexicons 引用不变（depth 检查留给消费者）
    expect(result.current.lexicons).toBe(before);
  });

  it('R5-FE-Polish-2: unmount 关闭对应的 EventSource（StrictMode 安全）', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'en-US', name: 'English', direction: 'ltr' }],
    });
    const { unmount } = renderHook(() => useAvailableLexicons());
    // 等 effect 跑完 + EventSource 创建
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThan(0);
    });
    const firstEs = FakeEventSource.instances[0];
    expect(firstEs.closed).toBe(false);

    // 模拟 StrictMode 第一次 cleanup
    unmount();

    // 该 effect 的本地 EventSource 必须被关闭
    expect(firstEs.closed).toBe(true);
  });

  it('R5-FE-Polish-2: 多次 mount/unmount 各自独立的 EventSource', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'en-US', name: 'English', direction: 'ltr' }],
    });

    const { unmount: unmount1 } = renderHook(() => useAvailableLexicons());
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBe(1);
    });
    const es1 = FakeEventSource.instances[0];

    const { unmount: unmount2 } = renderHook(() => useAvailableLexicons());
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBe(2);
    });
    const es2 = FakeEventSource.instances[1];

    // 两个独立 EventSource
    expect(es1).not.toBe(es2);

    // 卸载第一个 → 只关闭 es1
    unmount1();
    expect(es1.closed).toBe(true);
    expect(es2.closed).toBe(false);

    // 卸载第二个 → es2 也关
    unmount2();
    expect(es2.closed).toBe(true);
  });

  it('R6-FE-Polish-2: hook mounted under StrictMode wrapper still cleans up correctly', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [{ id: 'en-US', name: 'English', direction: 'ltr' }],
    });

    // 用 React.StrictMode 包装；测试 runtime 下不一定触发 double-mount，
    // 但即便 single-mount 也必须正常工作（不挂、不警告）。
    // unmount 调用后仍应清理 EventSource。
    const { unmount } = renderHook(() => useAvailableLexicons(), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(StrictMode, null, children),
    });

    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(1);
    });

    // 所有目前还存活的 ES 在 unmount 后都应关闭
    const all = [...FakeEventSource.instances];
    unmount();

    // 至少最后一个（活跃的 effect 所持有的）必须 closed
    expect(all[all.length - 1].closed).toBe(true);

    // 如果 StrictMode 触发了 double-mount，所有 ES 都该 closed
    // 否则至少一个（最近的）closed —— 不变式：unmount 后没有 ES 还活着
    for (const es of all) {
      expect(es.closed).toBe(true);
    }
  });

  it('R8-FE-3: SSE onerror schedules retry; unmount clears it AND advancing time creates no new EventSource', async () => {
    // 用 fake timers 监控 setTimeout 调度
    vi.useFakeTimers();
    try {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => [{ id: 'en-US', name: 'English', direction: 'ltr' }],
      });

      const { unmount } = renderHook(() => useAvailableLexicons());

      // 等 EventSource 被创建
      await vi.waitFor(() => {
        expect(FakeEventSource.instances.length).toBeGreaterThanOrEqual(1);
      });

      const esCountBeforeError = FakeEventSource.instances.length;
      const es = FakeEventSource.instances[0];
      // 触发 onerror —— hook 应该 setTimeout 重连
      const timersBeforeError = vi.getTimerCount();
      es.triggerError();
      const timersAfterError = vi.getTimerCount();
      // 至少多了一个 timer（retry）
      expect(timersAfterError).toBeGreaterThan(timersBeforeError);

      // 卸载 —— retry timer 应被 clearTimeout 清掉
      unmount();
      const timersAfterUnmount = vi.getTimerCount();
      expect(timersAfterUnmount).toBeLessThan(timersAfterError);

      // **关键不变式**：unmount 后即使时间推进 60s（远超 hook 的 retry delay），
      // 也不应该再创建新的 EventSource —— retry callback 已被 cleanup 取消
      const esCountAfterUnmount = FakeEventSource.instances.length;
      await vi.advanceTimersByTimeAsync(60_000);
      expect(FakeEventSource.instances.length).toBe(esCountAfterUnmount);
      expect(FakeEventSource.instances.length).toBe(esCountBeforeError);
    } finally {
      vi.useRealTimers();
    }
  });

  it('R5-FE-Polish-2: late SSE callback after unmount does not throw', async () => {
    // 这个测试验证：卸载后，FakeEventSource.pushMessage 仍可被调用（旧的 SSE
    // 帧到达不应导致整个程序崩溃）。
    // 我们**不**断言 React state ——因 testing-library 的 result.current 行为
    // 取决于版本。关键是 cancelled 标志阻止了 setState 引起的 React warning。
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 'en-US', name: 'English', direction: 'ltr' }],
    });
    const { unmount } = renderHook(() => useAvailableLexicons());
    await waitFor(() => {
      expect(FakeEventSource.instances.length).toBe(1);
    });
    const es = FakeEventSource.instances[0];

    unmount();
    expect(es.closed).toBe(true);

    // 关键：pushMessage 不抛错（cancelled 守护 onmessage 内部）
    expect(() => {
      es.pushMessage(JSON.stringify([
        { id: 'en-US', name: 'English', direction: 'ltr' },
        { id: 'zh-CN', name: '中文', direction: 'ltr' },
      ]));
    }).not.toThrow();
  });
});
