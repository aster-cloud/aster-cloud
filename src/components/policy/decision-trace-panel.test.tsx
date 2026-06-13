/**
 * DecisionTracePanel 的 AI 解释入口分支契约。
 *
 * 线上问题：公开 demo 的「AI 解释」按钮对匿名访客 401；改成 signInHref 链接后又出现
 * 「登录后跳 dashboard」「登录后按钮仍是登录提示」。修复后语义：
 *   - 传 signInHref（未登录）→ 渲染「登录后体验」链接，href 带 callbackUrl 跳回原页；
 *   - 不传 signInHref（已登录/受保护页）→ 渲染可用的 AI 解释按钮。
 * 本测试钉住这两个分支。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DecisionTracePanel, type DecisionTrace } from './decision-trace-panel';

// next-intl：key 原样返回，便于断言。
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// useAIAssistant：稳定空态，避免触发真实请求。
vi.mock('@/hooks/useAIAssistant', () => ({
  useAIAssistant: () => ({
    explain: vi.fn(),
    reset: vi.fn(),
    content: '',
    streaming: false,
    error: null,
  }),
}));

afterEach(cleanup);

const TRACE: DecisionTrace = {
  moduleName: 'credit.approval',
  functionName: 'decide',
  finalResult: 'Declined',
  executionTimeMs: 0.3,
  steps: [{ sequence: 1, expression: 'creditScore 561 >= 600', result: 'false', matched: false }],
};

describe('DecisionTracePanel AI-explain entry point', () => {
  it('renders a sign-in link (not the explain button) when signInHref is set', () => {
    render(
      <DecisionTracePanel
        trace={TRACE}
        source="Module m."
        locale="zh"
        signInHref="/zh/login?callbackUrl=%2Fzh%2Fdemo"
      />,
    );
    const link = screen.getByText('explainSignedIn').closest('a');
    expect(link).not.toBeNull();
    expect(link?.getAttribute('href')).toBe('/zh/login?callbackUrl=%2Fzh%2Fdemo');
    // 不应同时出现可点的「AI 解释」按钮。
    expect(screen.queryByRole('button', { name: 'explain' })).toBeNull();
  });

  it('renders the working AI Explain button when signInHref is absent', () => {
    render(<DecisionTracePanel trace={TRACE} source="Module m." locale="zh" />);
    // 渲染为按钮（已登录态），而非登录链接。
    const btn = screen.getByText('explain').closest('button');
    expect(btn).not.toBeNull();
    expect(screen.queryByText('explainSignedIn')).toBeNull();
  });

  it('renders no AI entry at all when source is absent', () => {
    render(<DecisionTracePanel trace={TRACE} locale="zh" />);
    expect(screen.queryByText('explain')).toBeNull();
    expect(screen.queryByText('explainSignedIn')).toBeNull();
  });
});
