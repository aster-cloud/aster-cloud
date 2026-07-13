import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonicalJson, canonicalHash, decimalTypeContext, CANONICALIZATION_VERSION } from './canonical-json';

/**
 * TS 侧 canonical parity 断言：证明 TS 参考实现产出 == 共享 fixture。
 *
 * 与 aster-lang-core 的 CanonicalJsonParityTest（断言 Java 产出 == 同一 fixture）配对：
 *   TS == fixture ∧ Java == fixture ⟹ TS == Java（字节级）。
 *
 * fixture 由本实现生成（scripts/gen 一次），此测试锁定「实现不漂移出 fixture」——若
 * 有人改 canonical-json.ts 改变产出而忘了同步 fixture / Java 侧，此测试立即红。
 */

interface Fixture {
  name: string;
  input: unknown;
  decimalPaths: string[];
  canonical: string;
  hash: string;
}

interface FixtureFile {
  version: string;
  cases: Fixture[];
}

const fixtures: FixtureFile = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'canonical-json-fixtures.json'), 'utf8'),
);

describe('canonical JSON parity — TS 产出 == 共享 fixture', () => {
  it('fixture 版本与 CANONICALIZATION_VERSION 一致', () => {
    expect(fixtures.version).toBe(CANONICALIZATION_VERSION);
  });

  it('fixture 非空（防 corpus 删除后假通过）', () => {
    expect(fixtures.cases.length).toBeGreaterThanOrEqual(20);
  });

  for (const f of fixtures.cases) {
    it(`${f.name}: canonical + hash 字节级匹配 fixture`, () => {
      const ctx = f.decimalPaths.length > 0 ? decimalTypeContext(f.decimalPaths) : undefined;
      expect(canonicalJson(f.input, ctx)).toBe(f.canonical);
      expect(canonicalHash(f.input, ctx)).toBe(f.hash);
    });
  }
});
