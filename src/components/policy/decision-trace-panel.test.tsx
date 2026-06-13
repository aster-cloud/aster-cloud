/**
 * DecisionTracePanel 渲染契约。
 *
 * 面板纯确定性渲染执行轨迹（步骤 + 表达式 + 结果 + 命中），不含任何 LLM/AI 解释——
 * LLM 解释代不准值、渲染坏、超宽，已全局移除，事实由 trace 本身（及 demo 的确定性
 * 解释）给出。本测试钉住：步骤逐项渲染、最终结果显示、无 AI 入口。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { DecisionTracePanel, type DecisionTrace } from './decision-trace-panel';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

afterEach(cleanup);

const TRACE: DecisionTrace = {
  moduleName: 'credit.approval',
  functionName: 'decide',
  finalResult: 'Approved — premium rate',
  executionTimeMs: 0.3,
  steps: [
    { sequence: 1, expression: 'creditScore 768 >= 740', result: 'true', matched: true },
    { sequence: 2, expression: 'dtiRatio 0.30 <= 0.35', result: 'true', matched: true },
  ],
};

describe('DecisionTracePanel', () => {
  it('renders every step expression and the final result', () => {
    render(<DecisionTracePanel trace={TRACE} />);
    expect(screen.getByText('creditScore 768 >= 740')).toBeTruthy();
    expect(screen.getByText('dtiRatio 0.30 <= 0.35')).toBeTruthy();
    expect(screen.getByText('Approved — premium rate')).toBeTruthy();
    // module.function 头部存在。
    expect(screen.getByText(/credit\.approval\.decide/)).toBeTruthy();
  });

  it('has no AI / explain entry point at all', () => {
    render(<DecisionTracePanel trace={TRACE} />);
    // 全局移除了 LLM 解释：不应出现 explain/登录 相关入口。
    expect(screen.queryByText('explain')).toBeNull();
    expect(screen.queryByText('explainSignedIn')).toBeNull();
    expect(document.querySelector('a[href*="login"]')).toBeNull();
  });

  it('shows the empty state when there are no steps', () => {
    render(<DecisionTracePanel trace={{ ...TRACE, steps: [] }} />);
    expect(screen.getByText('empty')).toBeTruthy();
  });
});
