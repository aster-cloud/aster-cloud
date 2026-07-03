/**
 * 用户自定义别名 TS 实现测试（ADR 0022 方案 D）。
 *
 * 核心：**Java↔TS envelope/canonical 逐字节 parity**。参照哈希由 aster-api 的
 * PolicyVersion.computeSourceEnvelope 生成（EnvelopeParityProbeTest）。两侧算法必须字节一致，
 * 否则同一别名集产出不同 envelope → 破坏可复现/跨引擎一致。任一侧改算法须同步更新两侧 + 本参照。
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalAliasJson,
  computeSourceEnvelope,
  validateUserAliases,
} from '@/lib/policy-alias';

describe('policy-alias — Java↔TS envelope parity', () => {
  // 来自 aster-api EnvelopeParityProbeTest（Java 参照值，2026-06-25）
  it('ENV_1: 全字段（别名+toolchain）与 Java 一致', () => {
    const env = computeSourceEnvelope(
      'Module M.\n\nRule p given x as Int, produce Int:\n  Return x times 3.',
      '{"TIMES":["multiplied by"]}',
      'en-US',
      'abi=1.0;core=dev;validator=1;build=test',
    );
    expect(env).toBe('54fd83653343de702d6beeed7a82e1b1f1c5ce86c52a67bed2c70fdc547c30e7');
  });

  it('ENV_2: 字段边界（"ab","c","","")与 Java 一致', () => {
    expect(computeSourceEnvelope('ab', 'c', '', '')).toBe(
      '2443f58475afa7e726cc67b3400a39d35eff8b3217d8491216adfa19a62020ec',
    );
  });

  it('ENV_3: null 别名 + 中文 locale 与 Java 一致', () => {
    expect(computeSourceEnvelope('content', null, 'zh-CN', 'tc')).toBe(
      '9db0801ccad54aa59b3fa73a636ab1b523994d9a4084c04fddc8f25ddd168c75',
    );
  });

  it('ENV_CJK: 多字节 UTF-8（中文 content + 中文别名）与 Java 一致', () => {
    // 防 parity 盲区：纯 ASCII 下两侧绿不代表多字节也绿（字节长 vs 字符长、JSON 非ASCII转义）
    expect(
      computeSourceEnvelope('模块 定价。规则 计算 给定 金额。', '{"TIMES":["乘以三遍"]}', 'zh-CN', 'tc'),
    ).toBe('a905a68730345126058d162fb82d3938ed31f0166c59aa5046dafddb4330d294');
  });

  it('ENV_EMOJI: 4 字节 UTF-8（emoji）与 Java 一致', () => {
    expect(computeSourceEnvelope('x 🎯 y', '{"PLUS":["加 上"]}', 'en-US', 't')).toBe(
      'dbf5cc6d1b50f402267f65bfb58651f48c178d5c97463a8a1a3c4cebac6aef53',
    );
  });

  it('独立锚点：帧 "1:a|0:|0:|0:|" 的 SHA-256（openssl 验证，非 Java 生成）', () => {
    // 防"Java/TS 一起错"：此值由 openssl 独立算出（printf '1:a|0:|0:|0:|' | openssl dgst -sha256）
    expect(computeSourceEnvelope('a', null, '', '')).toBe(
      '68fbcc50d3fabae237194d8c0f3e0795308e3f317e6244252ac5609be49620a9',
    );
  });

  it('null≡空串字段，别名变则 envelope 变', () => {
    expect(computeSourceEnvelope('c', null, 'en-US', 't')).toBe(
      computeSourceEnvelope('c', '', 'en-US', 't'),
    );
    expect(computeSourceEnvelope('c', '{"TIMES":["a b"]}', 'en-US', 't')).not.toBe(
      computeSourceEnvelope('c', '{"TIMES":["c d"]}', 'en-US', 't'),
    );
  });
});

describe('policy-alias — canonicalJson 确定性', () => {
  it('输入顺序无关，键有序、别名归一排序', () => {
    const a = canonicalAliasJson({ TIMES: ['multiplied by'], PLUS: ['added to'] });
    const b = canonicalAliasJson({ PLUS: ['added to'], TIMES: ['multiplied by'] });
    expect(a).toBe(b);
    expect(a!.indexOf('PLUS')).toBeLessThan(a!.indexOf('TIMES'));
  });

  it('空/null → null', () => {
    expect(canonicalAliasJson(null)).toBeNull();
    expect(canonicalAliasJson({})).toBeNull();
  });

  it('与 Java canonicalJson 格式对齐（紧凑无空格）', () => {
    expect(canonicalAliasJson({ TIMES: ['multiplied by'] })).toBe('{"TIMES":["multiplied by"]}');
  });
});

describe('policy-alias — validateUserAliases (H3)', () => {
  const canon = new Set(['plus', 'times', 'divided by', 'if', 'return']);

  it('低风险多词运算符别名通过', () => {
    expect(validateUserAliases({ TIMES: ['multiplied by'] }, canon).valid).toBe(true);
  });
  it('敏感 kind（RETURN）别名拒绝', () => {
    const r = validateUserAliases({ RETURN: ['approve as'] }, canon);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('不允许为'))).toBe(true);
  });
  it('单词别名拒绝（占标识符命名空间）', () => {
    expect(validateUserAliases({ TIMES: ['scaled'] }, canon).valid).toBe(false);
  });
  it('遮蔽规范拼写拒绝', () => {
    expect(validateUserAliases({ TIMES: ['divided by'] }, canon).valid).toBe(false);
  });
  it('非规范空白/大小写拒绝', () => {
    expect(validateUserAliases({ TIMES: ['scaled  by'] }, canon).valid).toBe(false);
    expect(validateUserAliases({ TIMES: ['Scaled By'] }, canon).valid).toBe(false);
  });
  it('null/空 → 合法', () => {
    expect(validateUserAliases(null, canon).valid).toBe(true);
    expect(validateUserAliases({}, canon).valid).toBe(true);
  });

  it('遮蔽 base 已有官方别名拒绝（对齐 Java reserved 含 base aliases）', () => {
    const r = validateUserAliases(
      { TIMES: ['scaled by'] },
      { canonicalKeywordsLower: canon, baseAliasesLower: new Set(['scaled by']) },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('官方别名'))).toBe(true);
  });

  it('撞领域词汇标识符拒绝（H3 标识符碰撞）', () => {
    const r = validateUserAliases(
      { TIMES: ['monthly fee'] },
      { canonicalKeywordsLower: canon, vocabularyTermsLower: new Set(['monthly fee']) },
    );
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('领域词汇'))).toBe(true);
  });
});

describe('policy-alias — 结构词别名授权闸（ADR 0022 结构词扩展）', () => {
  const canon = new Set(['plus', 'times', 'divided by', 'if', 'return']);

  it('未授权（默认）时结构词别名拒绝', () => {
    const r = validateUserAliases({ FUNC_TO: ['the rule for'] }, canon);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('结构词'))).toBe(true);
  });

  it('授权（allowStructural=true）时多词结构词别名通过', () => {
    const r = validateUserAliases(
      { FUNC_TO: ['the rule for'], IF: ['in the case that'], RETURN: ['the answer is'] },
      canon,
      { allowStructural: true },
    );
    expect(r.valid).toBe(true);
  });

  it('即便授权，结构词别名仍须多词', () => {
    const r = validateUserAliases({ FUNC_TO: ['rulefor'] }, canon, { allowStructural: true });
    expect(r.valid).toBe(false);
  });

  it('高危 kind（AND/IMPORT 等）任何授权都拒', () => {
    expect(validateUserAliases({ AND: ['together with'] }, canon, { allowStructural: true }).valid)
      .toBe(false);
  });
});

describe('policy-alias — W2 DoS 上界', () => {
  const canon = new Set(['plus', 'times', 'divided by', 'if', 'return']);

  it('kind 总数超上限拒绝', () => {
    const big: Record<string, string[]> = {};
    for (let i = 0; i < 33; i++) big[`K${i}`] = ['a b'];
    const r = validateUserAliases(big, canon);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('kind 数量'))).toBe(true);
  });

  it('单 kind 别名数超上限拒绝', () => {
    const many = Array.from({ length: 9 }, (_, i) => `alias number ${i}`);
    const r = validateUserAliases({ TIMES: many }, canon);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('别名数量'))).toBe(true);
  });

  it('单条别名超长拒绝（且不做正则）', () => {
    const long = 'a ' + 'x'.repeat(200);
    const r = validateUserAliases({ TIMES: [long] }, canon);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => e.includes('别名长度'))).toBe(true);
  });

  it('恰在上界内的输入合法', () => {
    const eight = Array.from({ length: 8 }, (_, i) => `alias phrase ${i}`);
    expect(validateUserAliases({ TIMES: eight }, canon).valid).toBe(true);
  });
});
