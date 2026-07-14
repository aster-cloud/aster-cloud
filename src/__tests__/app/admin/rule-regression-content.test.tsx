// RuleRegressionContent（回归报告查看）组件测试。
//
// 覆盖：load 前空态 / 加载报告表 + 四态徽章 label / case 概览 replay-limited 标记 /
// 后端错误 → loadError / 空报告态。不做像素级视觉断言（需人工 chrome-devtools 复核）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// @/components/ui barrel 在 jsdom 下解析 next-intl navigation 会失败——提供轻量替身。
vi.mock('@/components/ui', () => ({
  Container: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PageHeader: ({ title, subtitle }: { title: string; subtitle: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{subtitle}</p>
    </div>
  ),
  Breadcrumbs: () => <nav />,
}));

import { RuleRegressionContent } from '@/app/[locale]/(dashboard)/admin/rule-regression/rule-regression-content';

const REPORT = {
  id: 'r1',
  policyVersionRowId: 'pv1',
  status: 'PASS' as const,
  comparisonMode: 'FROZEN_BASELINE_VS_CURRENT_BACKEND',
  caseCount: 5,
  runnableCaseCount: 4,
  passedCaseCount: 4,
  failedCaseCount: 0,
  nonReplayableCaseCount: 1,
  reportHash: 'abcdef0123456789',
  currentRuntimeToolchainId: 'tc-1',
  createdAt: '2026-07-14T12:00:00.000Z',
};

const CASE_RUNNABLE = {
  id: 'c1',
  policyVersionRowId: 'pv1',
  functionName: 'approveLoan',
  locale: 'en-US',
  expectedDecision: 'approved',
  sourceKind: 'execution',
  coverageTags: [],
  replayLimited: false,
  canonicalInputHash: 'ih-1',
  createdAt: '2026-07-14T11:00:00.000Z',
};
const CASE_LIMITED = { ...CASE_RUNNABLE, id: 'c2', replayLimited: true, sourceKind: 'handwritten', coverageTags: ['boundary'] };

function mockFetchOnce(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, json: async () => body }))
  );
}

describe('RuleRegressionContent', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('load 前只显示标题 + 比对说明，无报告表', () => {
    render(<RuleRegressionContent />);
    expect(screen.getByText('title')).toBeTruthy();
    expect(screen.getByText('comparisonNote')).toBeTruthy();
    expect(screen.queryByText('reportsHeading')).toBeNull();
  });

  it('load 后渲染报告表 + PASS 状态 label + case 概览', async () => {
    mockFetchOnce({ reports: [REPORT], cases: [CASE_RUNNABLE, CASE_LIMITED] });
    render(<RuleRegressionContent />);
    fireEvent.change(screen.getByPlaceholderText('policyIdPlaceholder'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByText('load'));

    await waitFor(() => expect(screen.getByText('reportsHeading')).toBeTruthy());
    // PASS 状态用 statusPass label。
    expect(screen.getByText('statusPass')).toBeTruthy();
    // case 概览：runnable case 用 sourceExecution，limited 用 sourceHandwritten。
    expect(screen.getByText('sourceExecution')).toBeTruthy();
    expect(screen.getByText('sourceHandwritten')).toBeTruthy();
    // replay-limited 标记：一个 yes 一个 no。
    expect(screen.getAllByText('yes').length).toBe(1);
    expect(screen.getAllByText('no').length).toBe(1);
  });

  it('后端错误 → 显示 loadError，不崩', async () => {
    mockFetchOnce({}, false);
    render(<RuleRegressionContent />);
    fireEvent.change(screen.getByPlaceholderText('policyIdPlaceholder'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByText('loadError')).toBeTruthy());
  });

  it('空报告 → noReports 提示', async () => {
    mockFetchOnce({ reports: [], cases: [] });
    render(<RuleRegressionContent />);
    fireEvent.change(screen.getByPlaceholderText('policyIdPlaceholder'), { target: { value: 'p1' } });
    fireEvent.click(screen.getByText('load'));
    await waitFor(() => expect(screen.getByText('noReports')).toBeTruthy());
    expect(screen.getByText('noCases')).toBeTruthy();
  });

  it('policyId 为空时 load 按钮禁用', () => {
    render(<RuleRegressionContent />);
    const btn = screen.getByText('load') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
