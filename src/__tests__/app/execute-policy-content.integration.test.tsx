// ExecutePolicyContent 集成回归测试 (P0-R / codex High #1).
//
// 这是原始 P0-2 bug 的真正回归保护：执行页之前只传 trace 不传 source 给
// DecisionTracePanel，AI Explain 按钮永远不出现。修复后必须有测试能在 caller
// 端验证 source/locale 真的流通到 trace panel——这个集成测试就是这层保护。
//
// 原 component-only test (decision-trace-panel.test.tsx) 只验证 panel 自身在
// 收到 source 时显示按钮——这个测试在修复**前**也会通过，因为 bug 在 caller。
//
// 测试策略：
//   1. mock `/api/policies/${id}` 返回带 content 的 policy
//   2. mock `/api/policies/${id}/execute` 返回 trace
//   3. mock DecisionTracePanel 用一个 spy 组件捕获 props
//   4. 渲染 ExecutePolicyContent，触发 fetch + execute
//   5. 断言 spy 收到 `source` 等于 fetch 返回的 content

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';

// ============================================================
// Mocks
// ============================================================

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
    billing: true,
    pricing: true,
    riskTier: false,
    dunning: false,
    signup: true,
    mixpanel: false,
    resend: false,
    license: false,
    sso: false,
  },
}));

// Mock aster-lang-ts/browser —— 避免拉 Monaco 等重依赖
vi.mock('@aster-cloud/aster-lang-ts/browser', () => ({
  extractSchema: vi.fn(() => ({
    success: true,
    parameters: [{ name: 'value', type: 'Text', typeKind: 'primitive' }],
  })),
  generateFieldValue: vi.fn(() => 'sample'),
  generateInputValues: vi.fn(() => ({ value: 'sample' })),
  EN_US: { id: 'en-US' },
  ZH_CN: { id: 'zh-CN' },
  DE_DE: { id: 'de-DE' },
}));

// extractErrorMessage 简化
vi.mock('@/lib/api/error-envelope', () => ({
  extractErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

// DecisionTracePanel spy —— 捕获实际收到的 props 是这次测试的核心
const tracePanelProps = vi.fn();
vi.mock('@/components/policy/decision-trace-panel', () => ({
  DecisionTracePanel: (props: unknown) => {
    tracePanelProps(props);
    return <div data-testid="decision-trace-panel-mock" />;
  },
}));

// LoadingSkeleton 简化
vi.mock('@/components/feedback/loading-skeleton', () => ({
  LoadingSkeleton: () => <div data-testid="loading" />,
}));

// ============================================================
// Test setup
// ============================================================

const fetchMock = vi.fn();
const SAMPLE_SOURCE = `Module test.demo.

Rule check given x:
  Return x.
`;

const SAMPLE_TRACE = {
  moduleName: 'test.demo',
  functionName: 'check',
  steps: [],
  finalResult: 'ok',
  executionTimeMs: 5,
};

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  tracePanelProps.mockClear();
  fetchMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// ============================================================
// Tests
// ============================================================

describe('ExecutePolicyContent — source 透传到 DecisionTracePanel (P0-R 回归保护)', () => {
  it('执行 policy 后 DecisionTracePanel 应收到 source = 加载的 policy content', async () => {
    // 设置 fetch mock：
    //   1. GET /api/policies/${id} 返回 { content, name }
    //   2. POST /api/policies/${id}/execute 返回 { result, decisionTrace }
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/policies/test-policy-id') && (!init || !init.method || init.method === 'GET')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ name: 'Test Policy', content: SAMPLE_SOURCE }),
        });
      }
      if (url.includes('/api/policies/test-policy-id/execute')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            result: 'ok',
            decisionTrace: SAMPLE_TRACE,
          }),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`));
    });

    const { ExecutePolicyContent } = await import(
      '@/app/[locale]/(dashboard)/policies/[id]/execute/execute-policy-content'
    );

    render(<ExecutePolicyContent policyId="test-policy-id" locale="en" />);

    // 等待初始 fetch 完成（只验证 URL，不要求第二参数）
    await waitFor(() => {
      const calls = fetchMock.mock.calls;
      const fetched = calls.some((args) =>
        typeof args[0] === 'string' && args[0].endsWith('/api/policies/test-policy-id'),
      );
      expect(fetched).toBe(true);
    });

    // 触发执行：点击 "execute" 按钮（按 ns + key）
    // 这里我们直接调用 fetch 模拟执行已发生——更稳定地验证 trace panel 接线
    // 实际产品流程：用户填表单 → 点击执行按钮 → setResult 触发 trace 渲染

    // 触发执行：mock 的 useTranslations 把 `t('executeButton')` 变成
    // 'policies.execute.executeButton' 字符串
    const executeBtn = await waitFor(() => {
      const btn = screen.queryByText(/policies\.execute\.executeButton/i);
      if (!btn) throw new Error('execute button not found');
      return btn.closest('button')!;
    });

    fireEvent.click(executeBtn);

    // 等待 trace panel 出现
    await waitFor(
      () => {
        expect(screen.queryByTestId('decision-trace-panel-mock')).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    // ✦ 核心断言：trace panel 收到的 props 包含 source（这是 P0-2 的本质修复）
    expect(tracePanelProps).toHaveBeenCalled();
    const lastCallArgs = tracePanelProps.mock.calls.at(-1)![0] as {
      trace: unknown;
      source?: string;
      locale?: string;
    };

    expect(lastCallArgs.source).toBe(
      SAMPLE_SOURCE,
      // 这是回归断言：source 必须是 fetch 返回的 content。
      // 修复**前**这个 prop 是 undefined。
    );
    expect(lastCallArgs.locale).toMatch(/^(en-US|zh-CN|de-DE)$/);
    expect(lastCallArgs.trace).toBeDefined();
  });
});
