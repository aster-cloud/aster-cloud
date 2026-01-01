import { describe, it, expect } from 'vitest';
import { parseRules, evaluateRules } from '@/services/policy/parser';

describe('RuleParser', () => {
  describe('parseRules', () => {
    it('should parse equality rules', () => {
      const rules = parseRules('if amount == 100 then allow');

      expect(rules).toHaveLength(1);
      expect(rules[0]).toEqual(
        expect.objectContaining({
          field: 'amount',
          operator: 'eq',
          value: 100,
          action: 'allow',
        })
      );
    });

    it('should parse comparison rules', () => {
      const rules = parseRules('if amount > 50 then deny');

      expect(rules[0].operator).toBe('gt');
      expect(rules[0].action).toBe('deny');
    });

    it('should handle multiple rules', () => {
      const rules = parseRules(
        [
          'if amount > 50 then allow',
          'if status == "approved" then allow proceed',
        ].join('\n')
      );

      expect(rules.length).toBe(2);
      expect(rules[1].value).toBe('approved');
    });
  });

  describe('evaluateRules', () => {
    it('should return passed for matching input', () => {
      const rules = parseRules('if amount == 100 then allow');
      const result = evaluateRules(rules, { amount: 100 });

      expect(result[0].matched).toBe(true);
      expect(result[0].passed).toBe(true);
    });

    it('should attach deny reasons when rule matches', () => {
      const rules = parseRules('if amount >= 10000 then deny Manual review required');
      const result = evaluateRules(rules, { amount: 20000 });

      expect(result[0].passed).toBe(false);
      expect(result[0].reason).toBe('Manual review required');
    });
  });
});
