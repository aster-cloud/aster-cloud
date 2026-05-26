// DecisionTracePanel behavior:
//   - source 不传 → AI Explain 按钮**不显示**（向后兼容）
//   - source 传入 → AI Explain 按钮显示且可点击（P0-2 修复：执行页 trace 启用 AI 解释）
//   - 点击 AI Explain → 调用 useAIAssistant.explain，传入 source + locale + traceData
//
// 这是 P0-2 的回归测试 —— 执行页之前只传 trace 不传 source，
// 导致 AI Explain 按钮在生产链路永远不出现。详见 ADR-0009 P0-2 修复说明。

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { DecisionTracePanel, type DecisionTrace } from '@/components/policy/decision-trace-panel';

// next-intl mock：返回 key 字面值，方便 assertion
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => (key: string) => `${ns ?? ''}.${key}`,
}));

// useAIAssistant mock：捕获调用参数以便断言
const explainMock = vi.fn().mockResolvedValue(undefined);
const aiState = {
  explain: explainMock,
  generate: vi.fn(),
  suggest: vi.fn(),
  streaming: false,
  error: null,
  content: '',
  reset: vi.fn(),
};

vi.mock('@/hooks/useAIAssistant', () => ({
  useAIAssistant: () => aiState,
}));

const sampleTrace: DecisionTrace = {
  moduleName: 'examples.hipaa',
  functionName: 'validate_access_control',
  executionTimeMs: 12,
  finalResult: 'ok',
  steps: [
    {
      sequence: 1,
      expression: 'role equals to "physician"',
      result: true,
      matched: true,
    },
    {
      sequence: 2,
      expression: 'category equals to "MEDICAL"',
      result: false,
      matched: false,
    },
  ],
};

beforeEach(() => {
  explainMock.mockClear();
  aiState.streaming = false;
});

afterEach(() => {
  cleanup();
});

describe('DecisionTracePanel — AI Explain 按钮可见性（P0-2 回归保护）', () => {
  it('source 未提供时不应显示 AI Explain 按钮', () => {
    render(<DecisionTracePanel trace={sampleTrace} />);
    expect(screen.queryByText('ai.explain')).toBeNull();
  });

  it('source 提供时应显示 AI Explain 按钮', () => {
    render(
      <DecisionTracePanel
        trace={sampleTrace}
        source="Module examples.hipaa.\nRule validate_access_control given role:..."
        locale="en-US"
      />,
    );
    expect(screen.getByText('ai.explain')).toBeInTheDocument();
  });

  it('点击 AI Explain 应将 source + locale + traceData 传给 useAIAssistant.explain', async () => {
    const source = 'Module examples.hipaa.\nRule validate_access_control given role:...';
    render(
      <DecisionTracePanel trace={sampleTrace} source={source} locale="zh-CN" />,
    );
    const button = screen.getByText('ai.explain');
    fireEvent.click(button);

    expect(explainMock).toHaveBeenCalledOnce();
    const [options, tenantId] = explainMock.mock.calls[0];
    expect(options.source).toBe(source);
    expect(options.locale).toBe('zh-CN');
    expect(options.traceData).toEqual(sampleTrace);
    // tenantId 在客户端是 cosmetic 参数（server 从 NextAuth session 派生）
    void tenantId;
  });

  it('AI 正在 streaming 时按钮应 disabled', () => {
    aiState.streaming = true;
    render(
      <DecisionTracePanel
        trace={sampleTrace}
        source="Module x."
        locale="en-US"
      />,
    );
    const button = screen.getByText('ai.explain').closest('button');
    expect(button?.disabled).toBe(true);
  });
});

describe('DecisionTracePanel — 渲染基本内容', () => {
  it('应显示 module.function 标签 + 执行时间', () => {
    render(<DecisionTracePanel trace={sampleTrace} />);
    expect(
      screen.getByText('examples.hipaa.validate_access_control — 12ms'),
    ).toBeInTheDocument();
  });

  it('应渲染 trace steps（每步的 expression）', () => {
    render(<DecisionTracePanel trace={sampleTrace} />);
    expect(screen.getByText('role equals to "physician"')).toBeInTheDocument();
    expect(screen.getByText('category equals to "MEDICAL"')).toBeInTheDocument();
  });
});
