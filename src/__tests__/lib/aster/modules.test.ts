import { describe, expect, it } from 'vitest';
import { extractUseRefs } from '@/lib/aster/modules';

describe('extractUseRefs', () => {
  it('extracts Use with version and alias', () => {
    expect(extractUseRefs('Use risk.Scoring version 2 as Score.')).toEqual([
      {
        moduleName: 'risk.Scoring',
        version: 2,
        alias: 'Score',
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 37,
        },
        moduleRange: {
          startLineNumber: 1,
          startColumn: 5,
          endLineNumber: 1,
          endColumn: 17,
        },
        versionRange: {
          startLineNumber: 1,
          startColumn: 26,
          endLineNumber: 1,
          endColumn: 27,
        },
      },
    ]);
  });

  it('extracts Use with version only', () => {
    const refs = extractUseRefs('Use risk.Scoring version 2.');

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      moduleName: 'risk.Scoring',
      version: 2,
      alias: null,
    });
    expect(refs[0].versionRange).toEqual({
      startLineNumber: 1,
      startColumn: 26,
      endLineNumber: 1,
      endColumn: 27,
    });
  });

  it('extracts Use with alias only', () => {
    const refs = extractUseRefs('Use risk.Scoring as Score.');

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      moduleName: 'risk.Scoring',
      version: null,
      alias: 'Score',
      versionRange: null,
    });
  });

  it('extracts unpinned Use', () => {
    const refs = extractUseRefs('Use risk.Scoring.');

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      moduleName: 'risk.Scoring',
      version: null,
      alias: null,
      versionRange: null,
    });
  });

  it('skips comment lines', () => {
    const refs = extractUseRefs('// Use risk.Scoring version 2.\n# Use risk.Fraud.\nUse risk.Valid version 1.');

    expect(refs.map((ref) => ref.moduleName)).toEqual(['risk.Valid']);
  });

  it('extracts multiple Use declarations and supports multi-letter aliases', () => {
    const refs = extractUseRefs('Use risk.Scoring version 2 as Score.\nUse risk.Fraud as FraudCheck.');

    expect(refs.map((ref) => ({ moduleName: ref.moduleName, version: ref.version, alias: ref.alias }))).toEqual([
      { moduleName: 'risk.Scoring', version: 2, alias: 'Score' },
      { moduleName: 'risk.Fraud', version: null, alias: 'FraudCheck' },
    ]);
  });
});
