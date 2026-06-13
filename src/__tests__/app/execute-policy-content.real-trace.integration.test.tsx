// 集成测试：不 mock DecisionTracePanel，验证执行后真实面板渲染决策轨迹。
//
// LLM「AI Explain」已全局移除（代不准值、渲染坏、超宽）。本测试此前断言 AI Explain
// 按钮可见——现改为断言执行后真实 DecisionTracePanel 渲染轨迹步骤 + 最终结果，且
// **不存在任何 AI/explain 入口**。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ''}.${key}`,
}));

vi.mock('next/link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock('@/hooks/use-deployment-mode', () => ({
  CLIENT_CAPABILITIES: {
    billing: true, pricing: true, riskTier: false, dunning: false,
    signup: true, mixpanel: false, resend: false, license: false, sso: false,
  },
}));

vi.mock('@aster-cloud/aster-lang-ts/browser', () => ({
  extractSchema: vi.fn(() => ({
    success: true,
    parameters: [{ name: 'value', type: 'Text', typeKind: 'primitive' }],
  })),
  generateFieldValue: vi.fn(() => 'sample'),
  generateInputValues: vi.fn(() => ({ value: 'sample' })),
  EN_US: { id: 'en-US' }, ZH_CN: { id: 'zh-CN' }, DE_DE: { id: 'de-DE' },
}));

vi.mock('@/lib/api/error-envelope', () => ({
  extractErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

vi.mock('@/components/feedback/loading-skeleton', () => ({
  LoadingSkeleton: () => <div data-testid="loading" />,
}));

const fetchMock = vi.fn();
const SAMPLE_SOURCE = 'Module test.\nRule check given x:\n  Return x.\n';
const SAMPLE_TRACE = {
  moduleName: 'test', functionName: 'check',
  steps: [
    { sequence: 1, expression: 'x > 0', result: true, matched: true },
  ],
  finalResult: 'ok', executionTimeMs: 5,
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExecutePolicyContent — real DecisionTracePanel integration', () => {
  it('renders the decision trace after execution and has no AI/explain entry', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/policies/p1') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ name: 'P1', content: SAMPLE_SOURCE }),
        });
      }
      if (url.includes('/api/policies/p1/execute')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ result: 'ok', decisionTrace: SAMPLE_TRACE }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const { ExecutePolicyContent } = await import(
      '@/app/[locale]/(dashboard)/policies/[id]/execute/execute-policy-content'
    );
    render(<ExecutePolicyContent policyId="p1" locale="en" />);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (a) => typeof a[0] === 'string' && a[0].endsWith('/api/policies/p1'),
        ),
      ).toBe(true);
    });

    const executeBtn = await waitFor(() => {
      const btn = screen.queryByText(/policies\.execute\.executeButton/i);
      if (!btn) throw new Error('execute button not found');
      return btn.closest('button')!;
    });
    fireEvent.click(executeBtn);

    // 真实 DecisionTracePanel 渲染轨迹步骤 + 最终结果。
    await waitFor(
      () => {
        expect(screen.queryByText('x > 0')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
    expect(screen.getByText('ok')).toBeInTheDocument();

    // LLM 解释已移除：不存在任何 AI/explain 入口。
    expect(screen.queryByText(/ai\.explain/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ai\.explainSignedIn/i)).not.toBeInTheDocument();
  });
});
