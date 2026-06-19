// PlatformLanguageCard 重设后（每行 Toggle，乐观更新）的组件测试。
//
// 覆盖：
//   - 每个编译 locale 渲染一行 + On/Off 徽章随后端可用集
//   - 默认语言（en）Toggle 禁用，其余可用
//   - 点 Toggle → 乐观翻转 + 调 /api/admin/lexicons/{id}（enable/disable）
//   - 后端 4xx/5xx → 回滚乐观值 + 显示错误

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';

// next-intl：key + vars 透传（断言 key 名 / 含 language 变量）。
vi.mock('next-intl', () => ({
  useTranslations:
    (ns?: string) =>
    (key: string, vars?: Record<string, unknown>) =>
      `${ns ?? ''}.${key}${vars ? ` ${JSON.stringify(vars)}` : ''}`,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
}));

// @/components/ui barrel 会传递 import next-intl navigation（Breadcrumbs）→
// jsdom 下 pnpm 解析失败。本卡片只用少数原语，提供轻量替身（保留 Toggle 的
// role=switch/aria-checked 语义，测试据此断言）。
vi.mock('@/components/ui', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardBody: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Stack: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Toggle: ({
    checked,
    onChange,
    ariaLabel,
    disabled,
  }: {
    checked: boolean;
    onChange: (next: boolean) => void;
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  ),
}));

// 后端可用 lexicon（SSE）——默认 en/zh/de/hi 全开；按测试覆写。
const lexState = { lexicons: [] as Array<{ id: string; name: string; direction: 'ltr' | 'rtl' }>, loading: false };
vi.mock('@/hooks/useAvailableLexicons', () => ({
  useAvailableLexicons: () => lexState,
}));

import { PlatformLanguageCard } from '@/components/admin/platform-language-card';

const ALL = [
  { id: 'en-US', name: 'English', direction: 'ltr' as const },
  { id: 'zh-CN', name: '中文', direction: 'ltr' as const },
  { id: 'de-DE', name: 'Deutsch', direction: 'ltr' as const },
  { id: 'hi-IN', name: 'हिन्दी', direction: 'ltr' as const },
];

function setBackend(ids: string[]) {
  lexState.lexicons = ALL.filter((l) => ids.includes(l.id));
  lexState.loading = false;
}

describe('PlatformLanguageCard (redesigned per-row toggle)', () => {
  beforeEach(() => {
    setBackend(['en-US', 'zh-CN', 'de-DE', 'hi-IN']);
    vi.restoreAllMocks();
  });
  afterEach(() => cleanup());

  it('renders one row per compiled locale with a toggle each', () => {
    render(<PlatformLanguageCard />);
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    // 每行一个 switch（Toggle）。
    expect(screen.getAllByRole('switch')).toHaveLength(4);
  });

  it('default locale (en) toggle is disabled; others enabled', () => {
    render(<PlatformLanguageCard />);
    const switches = screen.getAllByRole('switch');
    // 第一行 = en（locales 顺序），Toggle 禁用。
    expect(switches[0]).toBeDisabled();
    expect(switches[1]).not.toBeDisabled();
  });

  it('reflects backend availability: disabled locale shows Off + unchecked', () => {
    setBackend(['en-US', 'zh-CN']); // de/hi 后端下线
    render(<PlatformLanguageCard />);
    const rows = screen.getAllByRole('listitem');
    // de 行（index 2）应 unchecked。
    const deSwitch = within(rows[2]).getByRole('switch');
    expect(deSwitch).toHaveAttribute('aria-checked', 'false');
    const zhSwitch = within(rows[1]).getByRole('switch');
    expect(zhSwitch).toHaveAttribute('aria-checked', 'true');
  });

  it('toggling a locale OFF optimistically flips it and calls disable BFF', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformLanguageCard />);
    const rows = screen.getAllByRole('listitem');
    const zhSwitch = within(rows[1]).getByRole('switch'); // zh 当前开
    fireEvent.click(zhSwitch);
    // 乐观翻转：立即 unchecked
    expect(zhSwitch).toHaveAttribute('aria-checked', 'false');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/lexicons/zh-CN',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ action: 'disable' }),
        }),
      );
    });
  });

  it('toggling a locale ON calls enable BFF', async () => {
    setBackend(['en-US']); // 仅 en 开，zh/de/hi 关
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformLanguageCard />);
    const rows = screen.getAllByRole('listitem');
    const deSwitch = within(rows[2]).getByRole('switch'); // de 当前关
    fireEvent.click(deSwitch);
    expect(deSwitch).toHaveAttribute('aria-checked', 'true');
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/admin/lexicons/de-DE',
        expect.objectContaining({ body: JSON.stringify({ action: 'enable' }) }),
      );
    });
  });

  it('after success, row stays busy until SSE converges, then re-enables', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    setBackend(['en-US', 'zh-CN', 'de-DE', 'hi-IN']); // 全开
    const { rerender } = render(<PlatformLanguageCard />);
    const zhSwitch = () => within(screen.getAllByRole('listitem')[1]).getByRole('switch');
    fireEvent.click(zhSwitch()); // 关 zh
    // 请求成功后：保留乐观覆盖 → 该行 busy（Toggle 禁用），等 SSE 收敛。
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await waitFor(() => expect(zhSwitch()).toBeDisabled());
    expect(zhSwitch()).toHaveAttribute('aria-checked', 'false');

    // 模拟 SSE 把后端集推进到目标（zh 下线）→ rerender。
    setBackend(['en-US', 'de-DE', 'hi-IN']);
    rerender(<PlatformLanguageCard />);

    // 收敛 effect 清掉乐观覆盖 → 行解禁，且仍为 off（与后端一致，无回跳）。
    await waitFor(() => expect(zhSwitch()).not.toBeDisabled());
    expect(zhSwitch()).toHaveAttribute('aria-checked', 'false');
  });

  it('rolls back optimistic flip + shows error when BFF rejects', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502, text: async () => '' });
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformLanguageCard />);
    const rows = screen.getAllByRole('listitem');
    const zhSwitch = within(rows[1]).getByRole('switch');
    fireEvent.click(zhSwitch); // 乐观关
    expect(zhSwitch).toHaveAttribute('aria-checked', 'false');
    // 失败回滚 → 回到开
    await waitFor(() => expect(zhSwitch).toHaveAttribute('aria-checked', 'true'));
    expect(screen.getByText(/platformLanguageSettings\.saveFailed/)).toBeInTheDocument();
  });

  it('default locale toggle does nothing (no BFF call) when clicked', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => '{}' });
    vi.stubGlobal('fetch', fetchMock);
    render(<PlatformLanguageCard />);
    const switches = screen.getAllByRole('switch');
    fireEvent.click(switches[0]); // en，禁用
    // 禁用的 toggle 不应触发请求
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
