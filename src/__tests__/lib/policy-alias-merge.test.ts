/**
 * 三层作用域别名合并（mergeAliasSets）测试 —— ADR 0022 方案 D 三层扩展（policy > team > tenant）。
 *
 * 合并粒度 = **按 kind 覆盖**：effective[kind] = policy[kind] ?? team[kind] ?? tenant[kind]
 * （层内该 kind 有非空别名才算“定了”）。Phase A 只用 policy 层；本测试同时验证 B/C 的多层语义。
 */
import { describe, expect, it } from 'vitest';
import { mergeAliasSets } from '@/lib/policy-alias-shared';

describe('mergeAliasSets — 按 kind 覆盖（policy > team > tenant）', () => {
  it('Phase A：只有 policy 层 → 原样返回', () => {
    const eff = mergeAliasSets({ policy: { TIMES: ['multiplied by'] } });
    expect(eff).toEqual({ TIMES: ['multiplied by'] });
  });

  it('policy 覆盖同 kind 的 team 与 tenant（整 kind 采用最高层）', () => {
    const eff = mergeAliasSets({
      tenant: { TIMES: ['乘以'] },
      team: { TIMES: ['乘上'] },
      policy: { TIMES: ['乘以金额'] },
    });
    expect(eff.TIMES).toEqual(['乘以金额']); // policy 胜出，非并集
  });

  it('policy 未定的 kind 用 team；team 未定的用 tenant（逐 kind 独立解析）', () => {
    const eff = mergeAliasSets({
      tenant: { GREATER_THAN: ['大于'], PLUS: ['加上'] },
      team: { PLUS: ['加'] },
      policy: {},
    });
    // GREATER_THAN 只 tenant 有 → 用 tenant；PLUS team 有 → team 覆盖 tenant
    expect(eff.GREATER_THAN).toEqual(['大于']);
    expect(eff.PLUS).toEqual(['加']);
  });

  it('高层该 kind 为空数组/全空白 → 视为“未定”，落到下一层', () => {
    const eff = mergeAliasSets({
      tenant: { TIMES: ['乘以'] },
      team: { TIMES: [] },          // 空数组 = 未定
      policy: { TIMES: ['   '] },   // 全空白 = 未定
    });
    expect(eff.TIMES).toEqual(['乘以']); // 落到 tenant
  });

  it('全空/无层 → {}', () => {
    expect(mergeAliasSets({})).toEqual({});
    expect(mergeAliasSets({ policy: null, team: undefined, tenant: {} })).toEqual({});
  });

  it('多 kind 混合：各 kind 独立按优先级解析', () => {
    const eff = mergeAliasSets({
      tenant: { TIMES: ['乘以'], AT_LEAST: ['至少'] },
      team: { GREATER_THAN: ['超过'] },
      policy: { TIMES: ['乘以金额'] },
    });
    expect(eff).toEqual({
      TIMES: ['乘以金额'],      // policy
      GREATER_THAN: ['超过'],   // team
      AT_LEAST: ['至少'],       // tenant
    });
  });
});
