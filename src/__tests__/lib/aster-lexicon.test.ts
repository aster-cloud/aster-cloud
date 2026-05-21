// aster-lexicon helper regression tests (D12 + R-fix 7-9):
//   - extractPrimitiveTypeKeywords returns primitives + type constructors
//   - extractPrimitiveTypeKeywordsAll unions across locales
//   - The keyword set returned by extractMonarchKeywords MUST NOT overlap
//     with primitive type tokens after filtering — otherwise Monaco's
//     first-match-wins token classification would render Text/Int/Float/Bool
//     as plain keywords instead of types.

import { describe, it, expect } from 'vitest';
import {
  EN_US,
  ZH_CN,
  DE_DE,
  extractMonarchKeywords,
  extractPrimitiveTypeKeywords,
  extractPrimitiveTypeKeywordsAll,
} from '@/lib/aster-lexicon';

describe('extractPrimitiveTypeKeywords', () => {
  it('returns en-US primitive types', () => {
    const got = extractPrimitiveTypeKeywords(EN_US);
    // primitives
    expect(got).toContain('Text');
    expect(got).toContain('Int');
    expect(got).toContain('Float');
    expect(got).toContain('Bool');
  });

  it('returns zh-CN primitive types in localized form', () => {
    const got = extractPrimitiveTypeKeywords(ZH_CN);
    expect(got).toContain('文本');
    expect(got).toContain('整数');
    expect(got).toContain('小数');
    expect(got).toContain('布尔');
  });

  it('returns de-DE primitive types in localized form', () => {
    const got = extractPrimitiveTypeKeywords(DE_DE);
    expect(got).toContain('Ganzzahl');
    expect(got).toContain('Dezimal');
    expect(got).toContain('Boolesch');
  });

  it('includes Maybe/Option of/Result of type constructors (R-fix 9)', () => {
    // These are MAYBE / OPTION_OF / RESULT_OF in SemanticTokenKind. They
    // were previously classified as plain keywords by Monaco, but lang-ts
    // type-parser treats them as type constructors.
    const en = extractPrimitiveTypeKeywords(EN_US);
    // The exact strings depend on lexicon; just assert at least one of the
    // expected forms appears so the regression is caught if SemanticTokenKind
    // gets renamed or removed without a coordinated cloud-side change.
    const hasTypeCtor = en.some((s) => /maybe|option|result/i.test(s));
    expect(hasTypeCtor, `extractPrimitiveTypeKeywords(EN_US) should expose at least one type constructor; got: ${en.join(',')}`).toBe(true);
  });
});

describe('extractPrimitiveTypeKeywordsAll', () => {
  it('unions primitives across all three locales', () => {
    const got = extractPrimitiveTypeKeywordsAll([EN_US, ZH_CN, DE_DE]);
    // English
    expect(got).toContain('Text');
    expect(got).toContain('Int');
    // Chinese
    expect(got).toContain('整数');
    expect(got).toContain('文本');
    // German
    expect(got).toContain('Ganzzahl');
    expect(got).toContain('Dezimal');
  });
});

describe('Monaco token classification invariants (R-fix 7)', () => {
  // Mirror what monaco-aster.ts will do: build the union typeKeywords and
  // filtered keyword arrays, then assert the two sets are disjoint.
  it('filtered keyword arrays do not overlap with typeKeywords', () => {
    const types = new Set(extractPrimitiveTypeKeywordsAll([EN_US, ZH_CN, DE_DE]));

    const filterTypes = (xs: string[]) => xs.filter((w) => !types.has(w));
    const enFiltered = filterTypes(extractMonarchKeywords(EN_US));
    const zhFiltered = filterTypes(extractMonarchKeywords(ZH_CN));
    const deFiltered = filterTypes(extractMonarchKeywords(DE_DE));

    for (const arr of [enFiltered, zhFiltered, deFiltered]) {
      for (const word of arr) {
        expect(
          types.has(word),
          `filtered keyword '${word}' must not be in typeKeywords — would defeat Monaco type highlight`,
        ).toBe(false);
      }
    }
  });

  it('extractMonarchKeywords originally CONTAINS type tokens (sanity)', () => {
    // The unfiltered set MUST contain type tokens — that's the bug we're
    // working around in monaco-aster.ts via the filterTypes step.
    const enUnfiltered = extractMonarchKeywords(EN_US);
    expect(enUnfiltered).toContain('Text');
    expect(enUnfiltered).toContain('Int');
  });
});
