// 别名策略的 schema 提取（「生成示例」路径）回归测试（ADR 0022）。
//
// Bug：设了运算符别名（如 + => "followed by"）的策略，源码写成 `"Hello " followed by name`，
// 在执行页 schema 提取阶段解析失败（Expected '.' at end of statement）→「生成示例」不可用，
// 虽然执行时（/evaluate 应用了别名）result 正确。根因：extractSchema 用的 lexicon 未合并
// 该策略的 aliasSet。修复：合并 aliasSet 进 lexicon.aliases 后再 extractSchema（与执行端 /
// useAsterCompiler 同口径）。本测试钉住"合并前失败、合并后成功"。

import { describe, it, expect } from 'vitest';
import { extractSchema, EN_US } from '@aster-cloud/aster-lang-ts/browser';

const SRC = `Module greeting.

Rule greeting given name as Text, produce Text:
  Return "Hello " followed by name.`;

// 用户设置：运算符别名 + => "followed by"（PLUS kind）。
const ALIAS_SET = { PLUS: ['followed by'] };

function mergeAliases(base: typeof EN_US, aliasSet: Record<string, readonly string[]>) {
  return {
    ...base,
    aliases: {
      ...((base as { aliases?: Record<string, readonly string[]> }).aliases ?? {}),
      ...aliasSet,
    },
  };
}

describe('别名策略 schema 提取（执行页「生成示例」）', () => {
  it('未合并别名 → 解析失败（复现 bug：Expected .）', () => {
    const r = extractSchema(SRC, { lexicon: EN_US });
    expect(r.success).toBe(false);
  });

  it('合并 aliasSet 进 lexicon.aliases → 成功提取参数（修复）', () => {
    const r = extractSchema(SRC, { lexicon: mergeAliases(EN_US, ALIAS_SET) });
    expect(r.success).toBe(true);
    expect(r.parameters?.some((p) => p.name === 'name')).toBe(true);
  });

  it('无别名的普通源码不受影响（合并空别名 = 基础 lexicon 行为）', () => {
    const plain = `Module m.

Rule greet given name as Text, produce Text:
  Return "Hello " + name.`;
    expect(extractSchema(plain, { lexicon: EN_US }).success).toBe(true);
    expect(extractSchema(plain, { lexicon: mergeAliases(EN_US, ALIAS_SET) }).success).toBe(true);
  });
});
