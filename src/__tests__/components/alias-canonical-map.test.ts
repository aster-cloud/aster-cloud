// H1 安全护栏②：buildAliasCanonicalRows 纯逻辑测试（ADR 0022）。
//
// 审批 UI 必须把冻结的别名集展成「别名短语 → 真实规范结构」，且结构词
// （Module/Rule/If…）显著标出——防止用无害措辞把结构词伪装成普通运算符骗审批。
// 本测试钉住三项安全关键行为：
//   1. kind → 规范关键词拼写（FUNC_TO→Rule, IF→If, TIMES→×…）
//   2. 结构词判定（structural=true）与排序（结构词排前）
//   3. 恶意/畸形输入优雅降级（返回 null，绝不抛）

import { describe, it, expect } from 'vitest';
import { buildAliasCanonicalRows } from '@/components/policy/version-detail-panel';

describe('buildAliasCanonicalRows (H1 审批规范化对照)', () => {
  it('运算符别名映射到正确的规范拼写', () => {
    const json = JSON.stringify({ TIMES: ['multiplied by'], DIVIDED_BY: ['split by'] });
    const rows = buildAliasCanonicalRows(json)!;
    const times = rows.find((r) => r.kind === 'TIMES')!;
    expect(times.canonical).toBe('×');
    expect(times.phrases).toEqual(['multiplied by']);
    expect(times.structural).toBe(false);
    expect(rows.find((r) => r.kind === 'DIVIDED_BY')!.canonical).toBe('÷');
  });

  it('结构词别名标记 structural=true 且映射到真实结构关键词', () => {
    const json = JSON.stringify({
      FUNC_TO: ['the rule for'],
      IF: ['in the case that'],
      RETURN: ['the answer is'],
    });
    const rows = buildAliasCanonicalRows(json)!;
    expect(rows.find((r) => r.kind === 'FUNC_TO')).toMatchObject({
      canonical: 'Rule',
      structural: true,
    });
    expect(rows.find((r) => r.kind === 'IF')).toMatchObject({ canonical: 'If', structural: true });
    expect(rows.find((r) => r.kind === 'RETURN')).toMatchObject({
      canonical: 'Return',
      structural: true,
    });
  });

  it('结构词排在运算符前（审批优先看高风险项）', () => {
    const json = JSON.stringify({ TIMES: ['x'], FUNC_TO: ['the rule for'], PLUS: ['y'] });
    const rows = buildAliasCanonicalRows(json)!;
    // 第一行必是结构词
    expect(rows[0].structural).toBe(true);
    expect(rows[0].kind).toBe('FUNC_TO');
    // 其余为运算符
    expect(rows.slice(1).every((r) => !r.structural)).toBe(true);
  });

  it('结构词伪装：无害措辞别名到 Rule 仍暴露为结构词', () => {
    // 攻击场景——把结构词 Rule 用看似普通的短语藏起来
    const json = JSON.stringify({ FUNC_TO: ['when we consider'] });
    const rows = buildAliasCanonicalRows(json)!;
    expect(rows).toHaveLength(1);
    // 措辞看着无害，但对照列必须暴露它其实是 Rule + 标结构词
    expect(rows[0].canonical).toBe('Rule');
    expect(rows[0].structural).toBe(true);
  });

  it('畸形 JSON → null（外层回退纯文本告警，绝不抛）', () => {
    expect(buildAliasCanonicalRows('{not json')).toBeNull();
    expect(buildAliasCanonicalRows('null')).toBeNull();
    expect(buildAliasCanonicalRows('[1,2,3]')).toBeNull();
    expect(buildAliasCanonicalRows('"a string"')).toBeNull();
  });

  it('非数组 value 的 kind 被跳过，字符串 phrases 被过滤', () => {
    const json = JSON.stringify({ TIMES: ['ok', 42, null], PLUS: 'not-array' });
    const rows = buildAliasCanonicalRows(json)!;
    expect(rows.find((r) => r.kind === 'PLUS')).toBeUndefined(); // 非数组跳过
    expect(rows.find((r) => r.kind === 'TIMES')!.phrases).toEqual(['ok']); // 只留字符串
  });

  it('未知 kind → canonical 回退为 kind 名本身（不崩）', () => {
    const json = JSON.stringify({ SOME_FUTURE_KIND: ['x'] });
    const rows = buildAliasCanonicalRows(json)!;
    expect(rows[0].canonical).toBe('SOME_FUTURE_KIND');
    expect(rows[0].structural).toBe(false);
  });
});
