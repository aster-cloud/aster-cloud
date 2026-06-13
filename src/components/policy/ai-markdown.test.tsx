/**
 * AiMarkdown 渲染契约。
 *
 * 线上反馈：AI 解释「不友好」——此前用 whitespace-pre-wrap 当纯文本渲染，模型输出的
 * Markdown 表格显示成生 `|...|` 管道符、`#` 标题不分级。本测试用模型典型输出（含 GFM
 * 表格、标题、加粗、列表、内联数值）验证：渲染出真实的 <table>/<th>/<td>/<h*> 结构，
 * 且把真实数值原样呈现——而不是把 Markdown 当字面文本堆出来。
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AiMarkdown } from './ai-markdown';

afterEach(cleanup);

const SAMPLE = `## 模块与数据结构

定义了数据类型：**申请人**，包含四个字段：

| 字段 | 类型 | 含义 |
|---|---|---|
| 信用分 | 整数 | 申请人的信用评分 |
| 月收入 | 小数 | 每月收入 |
| 月负债 | 小数 | 每月负债 |
| 申请额度 | 小数 | 申请贷款额度（当前规则未使用） |

## 执行轨迹

- 信用分：**561**
- 负债比：1640 ÷ 4100 = **0.40**

最终结果：拒绝 — 信用分低于门槛。`;

describe('AiMarkdown', () => {
  it('renders GFM tables as real <table> with filled cells (not raw pipes)', () => {
    render(<AiMarkdown content={SAMPLE} />);

    // 表格被渲染成真实 DOM 表格，而非纯文本管道符。
    const table = document.querySelector('table');
    expect(table).not.toBeNull();
    expect(document.querySelectorAll('th').length).toBe(3); // 字段 / 类型 / 含义
    expect(document.querySelectorAll('tbody tr').length).toBe(4); // 四个字段

    // 字段值真实呈现（含「未使用」标注），不是空单元格。
    expect(screen.getByText('信用分')).toBeTruthy();
    expect(screen.getByText(/当前规则未使用/)).toBeTruthy();

    // 渲染后的可见文本里不应残留 Markdown 表格分隔行的管道符串。
    const visible = document.body.textContent ?? '';
    expect(visible).not.toContain('|---|');
    expect(visible).not.toContain('| 字段 |');
  });

  it('renders headings and inline values', () => {
    render(<AiMarkdown content={SAMPLE} />);
    // 标题降级为 h4（与小字号面板协调），文本保留。
    const headings = [...document.querySelectorAll('h4, h5')].map((h) => h.textContent);
    expect(headings).toContain('模块与数据结构');
    expect(headings).toContain('执行轨迹');
    // 关键数值原样出现。
    expect(screen.getByText('561')).toBeTruthy();
    expect(screen.getByText('0.40')).toBeTruthy();
  });

  it('does not render raw HTML (XSS-safe)', () => {
    render(<AiMarkdown content={'正常文本 <img src=x onerror="alert(1)"> 结尾'} />);
    // react-markdown 默认不渲染原始 HTML：不应出现注入的 <img>。
    expect(document.querySelector('img')).toBeNull();
  });
});
