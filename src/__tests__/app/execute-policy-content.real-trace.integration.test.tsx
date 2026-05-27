// 第二层集成测试：不 mock DecisionTracePanel，验证 AI Explain 按钮真实可见。
//
// P0-R2 (codex review Medium #11): 原 execute-policy-content.integration.test.tsx
// mock 了 DecisionTracePanel 用 spy 捕获 props——证明 caller 传对了，但**不证明**
// panel 真显示按钮。本测试不 mock panel，渲染真实组件，断言 AI Explain
// 按钮出现 + 文本正确。这层加上 caller props 测试和 panel-only 测试，三层
// 组合保证完整链路。

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

// 注意：不 mock DecisionTracePanel —— 这是本测试的核心
// 但仍 mock useAIAssistant 避免真发 AI 请求
const explainMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/hooks/useAIAssistant', () => ({
  useAIAssistant: () => ({
    explain: explainMock,
    generate: vi.fn(),
    suggest: vi.fn(),
    streaming: false,
    error: null,
    content: '',
    reset: vi.fn(),
  }),
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
  explainMock.mockClear();
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ExecutePolicyContent — 真实 DecisionTracePanel 集成（P0-R2 / codex Medium #11）', () => {
  it('执行后 AI Explain 按钮真实可见（不 mock panel）', async () => {
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

    // 等待 fetch 完成
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          (a) => typeof a[0] === 'string' && a[0].endsWith('/api/policies/p1'),
        ),
      ).toBe(true);
    });

    // 点击执行
    const executeBtn = await waitFor(() => {
      const btn = screen.queryByText(/policies\.execute\.executeButton/i);
      if (!btn) throw new Error('execute button not found');
      return btn.closest('button')!;
    });
    fireEvent.click(executeBtn);

    // ✦ 核心断言：真实 DecisionTracePanel 渲染了 AI Explain 按钮
    // mock 的 useTranslations 把 t('explain') 映射为 'ai.explain'
    await waitFor(
      () => {
        expect(screen.queryByText(/ai\.explain/i)).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // 验证按钮可点击 + 点击后调用 useAIAssistant.explain
    const aiExplainBtn = screen.getByText(/ai\.explain/i).closest('button')!;
    expect(aiExplainBtn.disabled).toBe(false);
    fireEvent.click(aiExplainBtn);

    await waitFor(() => expect(explainMock).toHaveBeenCalled());
    const [callArgs] = explainMock.mock.calls[0];
    expect(callArgs.source).toBe(SAMPLE_SOURCE);
    expect(callArgs.traceData).toEqual(SAMPLE_TRACE);
  });
});
