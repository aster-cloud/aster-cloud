// AdminSidebar 行为：
//   - SaaS 模式：渲染 overview / aiBreaker / riskTier；不渲染 license / sso
//   - on-prem 模式：渲染 overview / aiBreaker / license / sso；不渲染 riskTier
//   - 当前路由对应的项有 aria-current="page"，其它项没有
//   - 嵌套子路由（如 /admin/risk-tier/abc）仍能高亮父项
//
// 注意：CAN_* 常量是编译期注入的 —— 用 vi.mock 整体替换 deployment-mode
// 模块在每个 describe 之间切换值。
//
// 测试不直接依赖 process.env，避免污染其它测试。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

// next-intl: 回显 key 让断言直接匹配 admin.nav.* 即可
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ''}.${key}`,
}));

// next/navigation 的 usePathname：每个测试可覆盖
let mockPathname = '/en/admin';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));

// i18n navigation 的 Link：渲染成普通 <a>，便于断言 href + aria-current
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...rest
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  vi.resetModules();
  mockPathname = '/en/admin';
});

describe('AdminSidebar — SaaS mode', () => {
  it('renders overview / aiBreaker / riskTier; hides license / sso', async () => {
    vi.doMock('@/lib/deployment-mode', () => ({
      CAN_BILLING: true,
      CAN_RISKTIER: true,
      CAN_LICENSE: false,
      CAN_SSO: false,
    }));
    const { AdminSidebar } = await import('@/components/admin/admin-sidebar');
    render(<AdminSidebar />);
    const nav = screen.getByRole('navigation');
    expect(nav).toBeInTheDocument();
    // i18n key 回显形式：admin.nav.<labelKey>
    expect(screen.getByText('admin.nav.overview')).toBeInTheDocument();
    expect(screen.getByText('admin.nav.aiBreaker')).toBeInTheDocument();
    expect(screen.getByText('admin.nav.riskTier')).toBeInTheDocument();
    expect(screen.queryByText('admin.nav.license')).not.toBeInTheDocument();
    expect(screen.queryByText('admin.nav.sso')).not.toBeInTheDocument();
  });

  it('overview 路径精确匹配高亮（不会被子路由误中）', async () => {
    mockPathname = '/en/admin'; // 严格在 overview
    vi.doMock('@/lib/deployment-mode', () => ({
      CAN_BILLING: true,
      CAN_RISKTIER: true,
      CAN_LICENSE: false,
      CAN_SSO: false,
    }));
    const { AdminSidebar } = await import('@/components/admin/admin-sidebar');
    render(<AdminSidebar />);

    const overviewLink = screen.getByText('admin.nav.overview').closest('a');
    expect(overviewLink).toHaveAttribute('aria-current', 'page');

    const aiBreakerLink = screen.getByText('admin.nav.aiBreaker').closest('a');
    expect(aiBreakerLink).not.toHaveAttribute('aria-current');
  });

  it('子路由（/admin/risk-tier/abc）让 risk-tier 项保持 active', async () => {
    mockPathname = '/en/admin/risk-tier/some-user-id';
    vi.doMock('@/lib/deployment-mode', () => ({
      CAN_BILLING: true,
      CAN_RISKTIER: true,
      CAN_LICENSE: false,
      CAN_SSO: false,
    }));
    const { AdminSidebar } = await import('@/components/admin/admin-sidebar');
    render(<AdminSidebar />);

    const riskTierLink = screen.getByText('admin.nav.riskTier').closest('a');
    expect(riskTierLink).toHaveAttribute('aria-current', 'page');

    // overview 不能被子路由误中
    const overviewLink = screen.getByText('admin.nav.overview').closest('a');
    expect(overviewLink).not.toHaveAttribute('aria-current');
  });
});

describe('AdminSidebar — On-Prem mode', () => {
  it('renders overview / aiBreaker / license / sso; hides riskTier', async () => {
    vi.doMock('@/lib/deployment-mode', () => ({
      CAN_BILLING: false,
      CAN_RISKTIER: false,
      CAN_LICENSE: true,
      CAN_SSO: true,
    }));
    const { AdminSidebar } = await import('@/components/admin/admin-sidebar');
    render(<AdminSidebar />);
    expect(screen.getByText('admin.nav.overview')).toBeInTheDocument();
    expect(screen.getByText('admin.nav.aiBreaker')).toBeInTheDocument();
    expect(screen.queryByText('admin.nav.riskTier')).not.toBeInTheDocument();
    expect(screen.getByText('admin.nav.license')).toBeInTheDocument();
    expect(screen.getByText('admin.nav.sso')).toBeInTheDocument();
  });

  it('on-prem 中 license 路径高亮', async () => {
    mockPathname = '/en/admin/license';
    vi.doMock('@/lib/deployment-mode', () => ({
      CAN_BILLING: false,
      CAN_RISKTIER: false,
      CAN_LICENSE: true,
      CAN_SSO: true,
    }));
    const { AdminSidebar } = await import('@/components/admin/admin-sidebar');
    render(<AdminSidebar />);

    const licenseLink = screen.getByText('admin.nav.license').closest('a');
    expect(licenseLink).toHaveAttribute('aria-current', 'page');
  });
});

describe('AdminSidebar — accessibility', () => {
  it('nav 元素带 aria-label', async () => {
    vi.doMock('@/lib/deployment-mode', () => ({
      CAN_BILLING: true,
      CAN_RISKTIER: true,
      CAN_LICENSE: false,
      CAN_SSO: false,
    }));
    const { AdminSidebar } = await import('@/components/admin/admin-sidebar');
    render(<AdminSidebar />);
    expect(
      screen.getByRole('navigation', { name: 'admin.nav.sidebarLabel' }),
    ).toBeInTheDocument();
  });

  it('导航是真实的 ul/li 列表（屏幕阅读器友好）', async () => {
    vi.doMock('@/lib/deployment-mode', () => ({
      CAN_BILLING: true,
      CAN_RISKTIER: true,
      CAN_LICENSE: false,
      CAN_SSO: false,
    }));
    const { AdminSidebar } = await import('@/components/admin/admin-sidebar');
    render(<AdminSidebar />);
    const list = screen.getByRole('list');
    expect(list.tagName).toBe('UL');
    // 至少 3 个 listitem（overview + aiBreaker + riskTier）
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(3);
  });
});
