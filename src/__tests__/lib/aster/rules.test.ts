import { describe, expect, it } from 'vitest';
import { chooseDefaultRule, extractRuleSymbols } from '@/lib/aster/rules';

describe('extractRuleSymbols', () => {
  it('extracts a single Rule and selects it by default', () => {
    const rules = extractRuleSymbols('Module demo.\n\nRule approve given applicant as Applicant:');

    expect(rules).toEqual([
      {
        name: 'approve',
        isEntry: false,
        range: {
          startLineNumber: 3,
          startColumn: 6,
          endLineNumber: 3,
          endColumn: 13,
        },
      },
    ]);
    expect(chooseDefaultRule(rules)).toBe('approve');
  });

  it('returns null for multiple rules without @entry', () => {
    const rules = extractRuleSymbols('Rule first:\nRule second:');

    expect(rules.map((rule) => rule.name)).toEqual(['first', 'second']);
    expect(chooseDefaultRule(rules)).toBeNull();
  });

  it('marks same-line @entry Rule and selects it', () => {
    const rules = extractRuleSymbols('Rule helper:\n@entry Rule main given input as Input:');

    expect(rules).toHaveLength(2);
    expect(rules[1]).toMatchObject({ name: 'main', isEntry: true });
    expect(chooseDefaultRule(rules)).toBe('main');
  });

  it('does not treat standalone @entry on the previous line as an entry rule', () => {
    const rules = extractRuleSymbols('@entry\nRule main:\nRule fallback:');

    expect(rules.map((rule) => ({ name: rule.name, isEntry: rule.isEntry }))).toEqual([
      { name: 'main', isEntry: false },
      { name: 'fallback', isEntry: false },
    ]);
    expect(chooseDefaultRule(rules)).toBeNull();
  });

  it('skips comment lines', () => {
    const rules = extractRuleSymbols('// Rule ignored:\n# @entry Rule alsoIgnored:\n@entry Rule active:');

    expect(rules.map((rule) => rule.name)).toEqual(['active']);
    expect(rules[0].isEntry).toBe(true);
  });

  it('supports English, Chinese, and German rule keywords with Latin and CJK names', () => {
    const rules = extractRuleSymbols('Rule latinName:\n规则 中文规则:\nRegel pruefen:\n@entry Regel haupt_regel:');

    expect(rules.map((rule) => rule.name)).toEqual(['latinName', '中文规则', 'pruefen', 'haupt_regel']);
    expect(chooseDefaultRule(rules)).toBe('haupt_regel');
  });
});
