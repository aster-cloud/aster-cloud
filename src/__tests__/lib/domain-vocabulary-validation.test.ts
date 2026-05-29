import { describe, expect, it } from 'vitest';
import {
  assembleDomainVocabularyFromLinks,
  computeDedupKey,
  normalizeTermInput,
  validateDomainVocabulary,
} from '@/lib/domain-vocabulary-validation';

describe('domain-vocabulary-validation', () => {
  describe('normalizeTermInput', () => {
    it('trims surrounding whitespace and produces lowercase norm columns', () => {
      const normalized = normalizeTermInput({
        domain: ' finance.loan ',
        locale: ' en-US ',
        kind: 'field',
        canonical: ' Principal ',
        localized: ' Principal Amount ',
        parentCanonical: ' Loan ',
        aliases: [' Amount ', '', '  '],
      });

      expect(normalized.domain).toBe('finance.loan');
      expect(normalized.locale).toBe('en-US');
      expect(normalized.canonical).toBe('Principal');
      expect(normalized.canonicalNorm).toBe('principal');
      expect(normalized.localizedNorm).toBe('principal amount');
      expect(normalized.parentCanonical).toBe('Loan');
      expect(normalized.parentCanonicalNorm).toBe('loan');
      expect(normalized.aliases).toEqual(['Amount']);
    });

    it('returns empty parentCanonicalNorm when parent is omitted', () => {
      const normalized = normalizeTermInput({
        domain: 'finance.loan',
        locale: 'en-US',
        kind: 'struct',
        canonical: 'Loan',
        localized: 'Loan',
      });

      expect(normalized.parentCanonical).toBeUndefined();
      expect(normalized.parentCanonicalNorm).toBe('');
    });
  });

  describe('computeDedupKey', () => {
    it('is stable across whitespace-only differences via normalized columns', () => {
      const a = normalizeTermInput({
        domain: 'finance.loan',
        locale: 'en-US',
        kind: 'struct',
        canonical: ' Borrower ',
        localized: ' Borrower ',
      });
      const b = normalizeTermInput({
        domain: 'finance.loan',
        locale: 'en-US',
        kind: 'struct',
        canonical: 'Borrower',
        localized: 'Borrower',
      });

      expect(computeDedupKey(a)).toBe(computeDedupKey(b));
    });

    it('differentiates by kind', () => {
      const base = {
        domain: 'finance.loan',
        locale: 'en-US',
        canonicalNorm: 'amount',
        localizedNorm: 'amount',
        parentCanonicalNorm: '',
      };
      expect(computeDedupKey({ ...base, kind: 'struct' })).not.toBe(
        computeDedupKey({ ...base, kind: 'field' }),
      );
    });

    it('differentiates by parentCanonicalNorm presence', () => {
      const base = {
        domain: 'finance.loan',
        locale: 'en-US',
        kind: 'field',
        canonicalNorm: 'amount',
        localizedNorm: 'amount',
      };
      expect(computeDedupKey({ ...base, parentCanonicalNorm: '' })).not.toBe(
        computeDedupKey({ ...base, parentCanonicalNorm: 'loan' }),
      );
    });
  });

  describe('assembleDomainVocabularyFromLinks', () => {
    it('groups rows by kind and preserves parent/alias metadata', () => {
      const vocab = assembleDomainVocabularyFromLinks([
        {
          domainTermId: 't1',
          domain: 'finance.loan',
          locale: 'en-US',
          kind: 'struct',
          canonical: 'Loan',
          localized: 'Loan',
          aliases: ['Facility'],
        },
        {
          domainTermId: 't2',
          domain: 'finance.loan',
          locale: 'en-US',
          kind: 'field',
          canonical: 'principal',
          localized: 'principal amount',
          parentCanonical: 'Loan',
        },
      ]);

      expect(vocab.id).toBe('finance.loan');
      expect(vocab.locale).toBe('en-US');
      expect(vocab.structs).toHaveLength(1);
      expect(vocab.structs[0].aliases).toEqual(['Facility']);
      expect(vocab.fields).toHaveLength(1);
      expect(vocab.fields[0].parent).toBe('Loan');
    });

    it('uses opts.domain and opts.locale when rows are empty', () => {
      const vocab = assembleDomainVocabularyFromLinks([], {
        domain: 'finance.loan',
        locale: 'en-US',
      });

      expect(vocab.id).toBe('finance.loan');
      expect(vocab.locale).toBe('en-US');
      expect(vocab.structs).toEqual([]);
    });
  });

  describe('validateDomainVocabulary', () => {
    it('accepts a well-formed vocabulary', () => {
      const vocab = assembleDomainVocabularyFromLinks([
        {
          domainTermId: 't1',
          domain: 'finance.loan',
          locale: 'en-US',
          kind: 'struct',
          canonical: 'Loan',
          localized: 'Loan',
        },
      ]);

      const result = validateDomainVocabulary(vocab);
      expect(result.valid).toBe(true);
    });

    it('rejects a vocabulary with an invalid ASCII canonical', () => {
      const vocab = assembleDomainVocabularyFromLinks([
        {
          domainTermId: 't1',
          domain: 'finance.loan',
          locale: 'en-US',
          kind: 'struct',
          canonical: '贷款',
          localized: '贷款',
        },
      ]);

      const result = validateDomainVocabulary(vocab);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });
});
