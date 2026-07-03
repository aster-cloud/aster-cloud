// 策略编辑器实时编译（footer 问题面板 + Monaco 红波浪线）别名回归测试（ADR 0022）。
//
// Bug：设了关键词/运算符别名的策略（如 + => "followed by"），编辑器 footer 和 Monaco 仍报
// 解析错误（Expected '.'）——因为 useCompile 用 validateSyntaxWithSpan(source, lexicon) 时
// lexicon 未合并 aliasSet。修复：合并 aliasSet 进 lexicon.aliases 后再校验（与 useAsterCompiler /
// 执行页 schema 提取 / 执行端同口径）。本测试钉住底层 validateSyntaxWithSpan 的行为。

import { describe, it, expect } from 'vitest';
import { validateSyntaxWithSpan, EN_US } from '@aster-cloud/aster-lang-ts/browser';

const SRC = `Module greeting.

Rule greeting given name as Text, produce Text:
  Return "Hello " followed by name.`;

// 用户设置：运算符别名 + => "followed by"（PLUS kind）。
const ALIAS = { PLUS: ['followed by'] };

const merged = {
  ...EN_US,
  aliases: {
    ...((EN_US as { aliases?: Record<string, readonly string[]> }).aliases ?? {}),
    ...ALIAS,
  },
};

describe('编辑器实时编译（footer + Monaco markers）别名支持', () => {
  it('基础 lexicon → 解析错误（复现 footer/波浪线误报）', () => {
    expect(validateSyntaxWithSpan(SRC, EN_US).length).toBeGreaterThan(0);
  });

  it('合并 aliasSet 进 lexicon.aliases → 无解析错误（修复）', () => {
    expect(validateSyntaxWithSpan(SRC, merged)).toEqual([]);
  });

  it('无别名的规范源码不受影响', () => {
    const plain = `Module m.

Rule greet given name as Text, produce Text:
  Return "Hello " + name.`;
    expect(validateSyntaxWithSpan(plain, EN_US)).toEqual([]);
    expect(validateSyntaxWithSpan(plain, merged)).toEqual([]);
  });
});
