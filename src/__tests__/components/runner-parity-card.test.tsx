/*
 * RunnerParityCard 行为测试：
 *   - 初次加载从 GET 读 mode/sample_pct（键按 .key 匹配）
 *   - mode 改变 → POST runner_parity.mode；失败回滚
 *   - sample_pct 失焦提交 → POST runner_parity.sample_pct（夹 0–100）；失败回滚
 *   - i18n 键缺失走 t.has() 内置英文兜底（ui-messages 未发版前可用）
 *   - ★诚实边界：卡片只调触发策略，不渲染任何"gate 决策"暗示
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent, act } from '@testing-library/react';

// next-intl mock：t 为回显函数 + t.has() 探针。默认 has=false → 卡片走内置英文兜底。
const hasImpl = vi.fn((_k: string) => false);
vi.mock('next-intl', () => {
  const t = (key: string, vars?: Record<string, unknown>) =>
    vars ? `t.${key}(${JSON.stringify(vars)})` : `t.${key}`;
  (t as unknown as { has: (k: string) => boolean }).has = (k: string) => hasImpl(k);
  return { useTranslations: () => t };
});

// UI 原语透传为原生元素（本测试只关心行为，不测样式）。
vi.mock('@/components/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
  Select: (props: React.SelectHTMLAttributes<HTMLSelectElement>) => <select {...props} />,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

const fetchMock = vi.fn();

beforeEach(() => {
  hasImpl.mockReturnValue(false); // 默认走英文兜底
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  hasImpl.mockReset();
});

// GET 返回：settings map 按 label 键，内含 {key,value}。卡片按 .key 匹配。
function mockGet(mode: string, pct: number) {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    json: async () => ({
      settings: {
        POLICY_SHARING_ENABLED: { key: 'policy_sharing.enabled', value: false },
        RUNNER_PARITY_MODE: { key: 'runner_parity.mode', value: mode },
        RUNNER_PARITY_SAMPLE_PCT: { key: 'runner_parity.sample_pct', value: pct },
      },
    }),
  });
}

async function renderCard() {
  const { RunnerParityCard } = await import('@/components/admin/runner-parity-card');
  const utils = render(<RunnerParityCard />);
  // 等初次 GET 完成、loading 结束——用稳定的 id（不随 i18n 变）等 mode select 出现。
  await waitFor(() => expect(utils.container.querySelector('#runner-parity-mode')).toBeTruthy());
  return utils;
}
// 稳定选择器（不依赖 i18n 文案）：
const modeSelect = () => document.querySelector('#runner-parity-mode') as HTMLSelectElement;
const pctInput = () => document.querySelector('#runner-parity-pct') as HTMLInputElement;

describe('RunnerParityCard', () => {
  it('初次加载：从 GET 回显 mode=sampled + sample_pct=25', async () => {
    mockGet('sampled', 25);
    await renderCard();
    const modeSel = modeSelect();
    expect(modeSel.value).toBe('sampled');
    const pct = pctInput();
    expect(pct.value).toBe('25');
    // sampled 模式 → pct 输入启用
    expect(pct.disabled).toBe(false);
  });

  it('mode≠sampled → sample_pct 输入禁用（其他模式该值无意义）', async () => {
    mockGet('every', 10);
    await renderCard();
    const pct = pctInput();
    expect(pct.disabled).toBe(true);
  });

  it('改 mode → POST runner_parity.mode', async () => {
    mockGet('off', 5);
    await renderCard();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    fireEvent.change(modeSelect(), { target: { value: 'every' } });
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body)).toEqual({ key: 'runner_parity.mode', value: 'every' });
    });
  });

  it('改 mode 失败 → 回滚到原值 + 显错', async () => {
    mockGet('off', 5);
    await renderCard();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'x' }) });
    const sel = modeSelect();
    fireEvent.change(sel, { target: { value: 'every' } });
    await waitFor(() => expect(sel.value).toBe('off')); // 回滚
    expect(screen.getByText(/Could not save/i)).toBeTruthy();
  });

  it('sample_pct 失焦提交（sampled 模式）→ POST 且夹到 0–100', async () => {
    mockGet('sampled', 5);
    await renderCard();
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });
    const pct = pctInput();
    fireEvent.blur(pct, { target: { value: '150' } }); // 越界 → 夹到 100
    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === 'POST');
      expect(JSON.parse(post![1].body)).toEqual({ key: 'runner_parity.sample_pct', value: 100 });
    });
  });

  it('sample_pct 无变化不打请求（幂等失焦）', async () => {
    mockGet('sampled', 30);
    await renderCard();
    const pct = pctInput();
    fireEvent.blur(pct, { target: { value: '30' } }); // 同值
    // 给微任务一拍
    await Promise.resolve();
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false);
  });

  it('i18n 键到位时用翻译（t.has=true → 不走英文兜底）', async () => {
    hasImpl.mockReturnValue(true); // 所有键都"存在"→ 用 t() 回显
    mockGet('off', 5);
    await renderCard();
    // t() 回显形如 "t.title"——证明走了翻译而非英文兜底 "Runner parity (shadow check)"
    expect(screen.getByText('t.title')).toBeTruthy();
    expect(screen.queryByText(/Runner parity \(shadow check\)/)).toBeNull();
  });

  it('★诚实边界：描述文案含 log-only/never gate，不含"gate 决策"承诺', async () => {
    mockGet('off', 5);
    await renderCard();
    expect(screen.getByText(/never gates any policy decision/i)).toBeTruthy();
  });

  it('sample_pct 保存失败 → 回滚到原值 + 显错（Codex 补：pct 回滚此前漏测）', async () => {
    mockGet('sampled', 20);
    await renderCard();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'x' }) });
    const pct = pctInput();
    fireEvent.blur(pct, { target: { value: '80' } });
    await waitFor(() => expect(pctInput().value).toBe('20')); // 回滚到 20（key remount 复位）
    expect(screen.getByText(/Could not save/i)).toBeTruthy();
  });

  it('网络异常（fetch reject）→ 回滚 + 显错（不冒泡崩溃）', async () => {
    mockGet('off', 5);
    await renderCard();
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const sel = modeSelect();
    fireEvent.change(sel, { target: { value: 'every' } });
    await waitFor(() => expect(sel.value).toBe('off'));
    expect(screen.getByText(/Could not save/i)).toBeTruthy();
  });

  it('★并发竞态（Codex 抓）：mode 请求失败迟到，不得覆盖此后更新的 mode 值', async () => {
    mockGet('off', 5);
    await renderCard();
    // 手动可控的两发请求：A（off→every，将失败）迟到；B（every→manual，成功）先落。
    const deferredA = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    fetchMock.mockReturnValueOnce(deferredA.promise); // A
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // B

    const sel = modeSelect();
    fireEvent.change(sel, { target: { value: 'every' } }); // A 发出，mode=every（乐观）
    // A 尚未 resolve；管理员又改到 manual（B 发出）。
    fireEvent.change(sel, { target: { value: 'manual' } });
    await waitFor(() => expect(sel.value).toBe('manual')); // B 成功，mode=manual

    // 现在 A 迟到失败。版本号守卫：A 非最新（mine≠latest）→ 整体作废，不回滚，保留 manual。
    deferredA.resolve({ ok: false, json: async () => ({ error: 'x' }) });
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(sel.value).toBe('manual'); // ★关键：A 失败不覆盖 B 的新值（确定性断言）
  });

  it('★ABA 竞态（Codex 抓 v2）：off→every(A)→manual(B)→every(C)，C 成功后 A 迟到失败不得回滚到 off', async () => {
    mockGet('off', 5);
    await renderCard();
    // A(off→every) 失败且迟到；B(→manual) 与 C(→every) 成功。C 让值又回到 'every'（=A 的目标）——
    // 纯值比较 cur==='every' 会误判是 A 的值 → 回滚到 off（ABA 击穿）。版本号守卫必须挡住。
    const deferredA = deferred<{ ok: boolean; json: () => Promise<unknown> }>();
    fetchMock.mockReturnValueOnce(deferredA.promise); // A
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // B
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) }); // C

    const sel = modeSelect();
    fireEvent.change(sel, { target: { value: 'every' } });   // A
    fireEvent.change(sel, { target: { value: 'manual' } });  // B
    await waitFor(() => expect(sel.value).toBe('manual'));
    fireEvent.change(sel, { target: { value: 'every' } });   // C —— 值又回到 'every'
    await waitFor(() => expect(sel.value).toBe('every'));

    // A 迟到失败。版本号：A 是 v1，最新是 C(v3) → A 作废，绝不回滚。值必须留在 'every'（C 的结果）。
    deferredA.resolve({ ok: false, json: async () => ({ error: 'x' }) });
    // 充分 flush A 的 then 链 + React 提交（若版本守卫失效，回滚会把值改回 'off'）。
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(sel.value).toBe('every'); // ★ABA 未击穿：仍是 every 而非回滚到 off（确定性断言，非 waitFor 容忍）
  });

  it('per-key 状态独立：mode 失败 + pct 成功，mode 的错误不被 pct 的成功抹掉', async () => {
    mockGet('sampled', 10);
    await renderCard();
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'x' }) }); // mode 失败
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });    // pct 成功
    fireEvent.change(modeSelect(), { target: { value: 'every' } });
    fireEvent.blur(pctInput(), { target: { value: '40' } });
    // mode 行显错、pct 行显存——两行并存（per-key 不互相覆盖）。
    await waitFor(() => expect(screen.getByText(/Trigger mode:.*Could not save/i)).toBeTruthy());
    expect(screen.getByText(/Sample percentage:.*Saved/i)).toBeTruthy();
  });

  it('无障碍：Label htmlFor 关联 mode select / pct input（可被 label 定位）', async () => {
    mockGet('sampled', 10);
    await renderCard();
    // getByLabelText 依赖 label→control 关联；能取到即证 htmlFor/id 正确对应。
    expect(screen.getByLabelText(/Trigger mode/i)).toBe(modeSelect());
    expect(screen.getByLabelText(/Sample percentage/i)).toBe(pctInput());
    // pct 输入声明 aria-describedby 指向 hint。
    expect(pctInput().getAttribute('aria-describedby')).toBe('runner-parity-pct-hint');
  });
});

// 可控 promise 小工具（并发竞态测试用）。
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}
