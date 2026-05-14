/**
 * R5-FE-Polish: deepMergeMessages 单元测试。
 *
 * 主要覆盖 R3/R4 修复的语义：
 * - R3: 空串 / 全角空格 / tab-only 视为 "未翻译"，保留 base
 * - R4: null 不能覆盖 base 的有效值
 */
import { describe, it, expect } from 'vitest';
import { deepMergeMessages } from '@/i18n/request';

describe('deepMergeMessages', () => {
  it('plain override replaces base value', () => {
    const merged = deepMergeMessages(
      { hello: 'Hello' },
      { hello: '你好' }
    );
    expect(merged).toEqual({ hello: '你好' });
  });

  it('empty string in override falls back to base', () => {
    const merged = deepMergeMessages(
      { hello: 'Hello' },
      { hello: '' }
    );
    expect(merged.hello).toBe('Hello');
  });

  it('whitespace-only override falls back to base (R3)', () => {
    const merged = deepMergeMessages(
      { hello: 'Hello' },
      { hello: '   ' }
    );
    expect(merged.hello).toBe('Hello');
  });

  it('全角空格 only override falls back to base', () => {
    const merged = deepMergeMessages(
      { hello: 'Hello' },
      { hello: '　　' }
    );
    expect(merged.hello).toBe('Hello');
  });

  it('R4: null override does NOT replace valid base value', () => {
    const merged = deepMergeMessages(
      { hello: 'Hello' },
      { hello: null as unknown as string }
    );
    expect(merged.hello).toBe('Hello');
  });

  it('undefined override leaves base intact', () => {
    const merged = deepMergeMessages(
      { hello: 'Hello' },
      { hello: undefined }
    );
    expect(merged.hello).toBe('Hello');
  });

  it('recursive object merge respects R4 null rule', () => {
    const merged = deepMergeMessages(
      { common: { hello: 'Hello', bye: 'Bye' } },
      { common: { hello: '你好', bye: null as unknown as string } }
    );
    expect(merged.common).toEqual({ hello: '你好', bye: 'Bye' });
  });

  it('preserves base keys not present in override', () => {
    const merged = deepMergeMessages(
      { a: 'A', b: 'B' },
      { a: '替换' }
    );
    expect(merged).toEqual({ a: '替换', b: 'B' });
  });

  it('does not mutate inputs', () => {
    const base = { hello: 'Hello' };
    const override = { hello: '你好' };
    deepMergeMessages(base, override);
    expect(base).toEqual({ hello: 'Hello' });
    expect(override).toEqual({ hello: '你好' });
  });

  it('numeric values pass through', () => {
    const merged = deepMergeMessages(
      { count: 0 },
      { count: 42 }
    );
    expect(merged.count).toBe(42);
  });

  it('boolean override applies (non-string non-null)', () => {
    const merged = deepMergeMessages(
      { enabled: false },
      { enabled: true }
    );
    expect(merged.enabled).toBe(true);
  });

  it('R4 regression: null does not corrupt nested string', () => {
    // 真实场景：翻译 JSON 中 zh 不小心写了 null
    const merged = deepMergeMessages(
      { auth: { signIn: 'Sign in', signUp: 'Sign up' } },
      { auth: { signIn: '登录', signUp: null as unknown as string } }
    );
    expect(merged.auth).toEqual({ signIn: '登录', signUp: 'Sign up' });
  });

  it('R7-FE-Polish-3: array override replaces base array (not merge)', () => {
    // 翻译 JSON 中数组（如示例列表）的覆盖语义
    const merged = deepMergeMessages(
      { items: ['a', 'b', 'c'] },
      { items: ['x', 'y'] }
    );
    expect(merged.items).toEqual(['x', 'y']);
  });

  it('R8-FE-4: empty array override replaces base (current contract: arrays always replace, even when empty)', () => {
    // 当前 deepMerge 合约：array 走 `else if (o !== undefined && o !== null)` 分支
    // 整体替换，包括 []。如果未来想把空数组视为"未翻译"，需在 deepMergeMessages
    // 里加 `Array.isArray(o) && o.length === 0 → 保留 base` 分支。
    const merged = deepMergeMessages(
      { items: ['a', 'b'] },
      { items: [] }
    );
    expect(merged.items).toEqual([]);
  });

  it('R7-FE-Polish-3: type mismatch — base is object, override is string → override wins', () => {
    // base 是 {auth: {...}}，override 写 auth: "broken" → string override 整体替换
    const merged = deepMergeMessages(
      { auth: { signIn: 'Sign in' } },
      { auth: 'unexpected-string' as unknown as Record<string, unknown> }
    );
    // 因 override.auth 是 string + 非空 → 整体替换 base.auth
    expect(merged.auth).toBe('unexpected-string');
  });

  it('R7-FE-Polish-3: type mismatch — base is string, override is object → object wins', () => {
    const merged = deepMergeMessages(
      { auth: 'simple' },
      { auth: { nested: 'value' } as unknown as string }
    );
    // override 是 object → 走 else if (o !== undefined && o !== null) → 替换
    expect(merged.auth).toEqual({ nested: 'value' });
  });

  it('R7-FE-Polish-3: number type passes through with override semantics', () => {
    const merged = deepMergeMessages(
      { count: 1 },
      { count: 42 }
    );
    expect(merged.count).toBe(42);
  });
});
