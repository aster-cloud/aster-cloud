/**
 * 信贷风控 demo 规则的**生产可验证性**契约。
 *
 * /demo 页按语言展示规则（中文站中文规则、德文站德文规则），且**标识符也本地化**
 * （模块/类型/规则/参数/字段名按语言）。这些规则不是装饰性文本——它们必须能在生产同款
 * 引擎里**真正编译且执行**，否则就是给客户/监管演示时当场翻车。
 *
 * 本测试用与生产相同的 `@aster-cloud/aster-lang-ts/browser` 引擎，覆盖两条路径：
 *   1. **默认阈值**：en/zh/de 三语规则逐一编译（无诊断错误）并对三个申请人执行，
 *      引擎决策必须与客户端镜像 `computeDecision()` 完全一致。
 *   2. **改阈值重跑**（demo 核心交互）：放宽阈值后引擎重新编译/执行，决策随之变化，
 *      且仍与 `computeDecision()` 一致——证明「改规则 → 浏览器引擎重跑」真实可信。
 * 任一语言不编译、或引擎决策与镜像不符 = CI 硬失败。
 */
import { describe, it, expect } from 'vitest';
import { compile, evaluate, EN_US, ZH_CN, DE_DE } from '@aster-cloud/aster-lang-ts/browser';
import {
  buildRuleSource,
  toEvalContext,
  getRuleName,
  computeDecision,
  buildDecisionRecord,
  digestDecision,
  DEFAULT_THRESHOLDS,
  DEMO_APPLICANTS,
  BOUNDARY_PAIR,
  type DemoLocale,
  type Thresholds,
} from '@/config/credit-risk-demo';

const LEXICONS: Record<DemoLocale, unknown> = { en: EN_US, zh: ZH_CN, de: DE_DE };
const LOCALES: DemoLocale[] = ['en', 'zh', 'de'];

/** 编译 + 逐申请人执行，断言引擎决策 === 客户端镜像 computeDecision。 */
function assertEngineMatchesMirror(loc: DemoLocale, th: Thresholds) {
  const source = buildRuleSource(loc, th);
  const result = compile(source, { lexicon: LEXICONS[loc] } as Parameters<typeof compile>[1]);
  const diags = ((result as { diagnostics?: { severity?: string }[] }).diagnostics ?? []).filter(
    (d) => d.severity === 'error',
  );
  if (!result.core || diags.length > 0) {
    console.error(`[${loc}] compile failed:`, JSON.stringify(diags));
  }
  expect(result.core, `[${loc}] core`).toBeTruthy();
  expect(diags.length, `[${loc}] diagnostics: ${JSON.stringify(diags)}`).toBe(0);

  for (const app of Object.values(DEMO_APPLICANTS)) {
    const ev = evaluate(result.core!, getRuleName(loc), toEvalContext(loc, app));
    expect(ev.success, `[${loc}] ${app.id} eval failed: ${ev.error ?? ''}`).toBe(true);
    const mirror = computeDecision(loc, app, th);
    // 引擎是决策权威；镜像必须逐字吻合，否则回放 trace 会与真实决策脱节。
    expect(String(ev.value), `[${loc}] ${app.id}`).toBe(mirror.decision);
  }
}

describe('credit-risk demo rules compile & run in every language', () => {
  describe('default thresholds', () => {
    for (const loc of LOCALES) {
      it(`${loc}: localized rule compiles and every applicant matches the mirror`, () => {
        assertEngineMatchesMirror(loc, DEFAULT_THRESHOLDS);
      });
    }
  });

  describe('edited thresholds re-run (改规则重跑)', () => {
    // 放宽 premium 门槛：分数门槛降到 600、DTI 上限放到 0.50（可负担上限保持宽松）。
    const relaxed: Thresholds = {
      premiumScore: 600,
      premiumDti: 0.5,
      standardScore: 660,
      standardDti: 0.43,
      minScore: 600,
      maxLti: 5,
    };

    for (const loc of LOCALES) {
      it(`${loc}: relaxing thresholds re-runs through the engine and still matches`, () => {
        assertEngineMatchesMirror(loc, relaxed);
      });
    }

    it('relaxed premium threshold actually flips the refer applicant to approved', () => {
      // 守住「改阈值确实改变决策」——否则测试看似通过却没验证到重跑语义。
      const before = computeDecision('en', DEMO_APPLICANTS.refer, DEFAULT_THRESHOLDS);
      const after = computeDecision('en', DEMO_APPLICANTS.refer, relaxed);
      expect(before.outcome).toBe('refer');
      expect(after.outcome).toBe('approved');

      const result = compile(buildRuleSource('en', relaxed), { lexicon: EN_US } as Parameters<typeof compile>[1]);
      const ev = evaluate(result.core!, getRuleName('en'), toEvalContext('en', DEMO_APPLICANTS.refer));
      expect(String(ev.value)).toBe(after.decision);
    });
  });

  describe('boundary pair flips on a single credit-score point (边界 1 分翻转)', () => {
    // demo 的核心卖点：BOUNDARY_PAIR 两份申请仅 creditScore 差 1 分（660 vs 659），
    // 在默认阈值下决策必须翻转（660 → standard approved；659 → refer）。这条测试把
    // 该卖点钉死——以后改样例或默认阈值若意外抹掉翻转，CI 立刻失败。
    it('pass(660) and fail(659) differ only by one credit-score point', () => {
      const { pass, fail } = BOUNDARY_PAIR;
      expect(pass.creditScore - fail.creditScore).toBe(1);
      // 除 creditScore + id 外字段完全相同（同一申请、同一规则，只差 1 分）。
      expect(fail).toEqual({ ...pass, id: fail.id, creditScore: fail.creditScore });
    });

    for (const loc of LOCALES) {
      it(`${loc}: the real engine flips the decision at the 660 boundary`, () => {
        const result = compile(buildRuleSource(loc, DEFAULT_THRESHOLDS), { lexicon: LEXICONS[loc] } as Parameters<typeof compile>[1]);
        expect(result.core, `[${loc}] core`).toBeTruthy();

        const evPass = evaluate(result.core!, getRuleName(loc), toEvalContext(loc, BOUNDARY_PAIR.pass));
        const evFail = evaluate(result.core!, getRuleName(loc), toEvalContext(loc, BOUNDARY_PAIR.fail));
        const mirrorPass = computeDecision(loc, BOUNDARY_PAIR.pass, DEFAULT_THRESHOLDS);
        const mirrorFail = computeDecision(loc, BOUNDARY_PAIR.fail, DEFAULT_THRESHOLDS);

        // 引擎与镜像一致。
        expect(String(evPass.value), `[${loc}] pass`).toBe(mirrorPass.decision);
        expect(String(evFail.value), `[${loc}] fail`).toBe(mirrorFail.decision);
        // 真引擎确实翻转：660 批准、659 转人工，两决策不同。
        expect(mirrorPass.outcome, `[${loc}] pass outcome`).toBe('approved');
        expect(mirrorFail.outcome, `[${loc}] fail outcome`).toBe('refer');
        expect(String(evPass.value)).not.toBe(String(evFail.value));
      });
    }
  });

  describe('requested amount is a live decision lever (申请额度生效)', () => {
    // 申请额度通过可负担上限（月收入 × 12 × maxLti）参与决策。强申请人若申请额度
    // 暴增到超过上限，即便信用分/负债比仍达标，也从「批准」降级为「转人工」。
    for (const loc of LOCALES) {
      it(`${loc}: oversized requested amount downgrades an otherwise-approved applicant`, () => {
        const strong = DEMO_APPLICANTS.approved; // 768 / income 9200
        // 默认 maxLti=5 → cap = 9200 × 12 × 5 = 552000。
        const within = { ...strong, requestedAmount: 240000 }; // ≤ cap → premium
        const over = { ...strong, requestedAmount: 900000 }; // > cap → refer

        const result = compile(buildRuleSource(loc, DEFAULT_THRESHOLDS), { lexicon: LEXICONS[loc] } as Parameters<typeof compile>[1]);
        expect(result.core, `[${loc}] core`).toBeTruthy();

        const evWithin = evaluate(result.core!, getRuleName(loc), toEvalContext(loc, within));
        const evOver = evaluate(result.core!, getRuleName(loc), toEvalContext(loc, over));
        const mirrorWithin = computeDecision(loc, within, DEFAULT_THRESHOLDS);
        const mirrorOver = computeDecision(loc, over, DEFAULT_THRESHOLDS);

        // 引擎与镜像一致，且额度确实改变了结果（approved → refer）。
        expect(String(evWithin.value), `[${loc}] within`).toBe(mirrorWithin.decision);
        expect(String(evOver.value), `[${loc}] over`).toBe(mirrorOver.decision);
        expect(mirrorWithin.outcome).toBe('approved');
        expect(mirrorOver.outcome).toBe('refer');
        expect(evWithin.value).not.toBe(evOver.value);
      });
    }
  });
});

describe('decision hash (PoC：可独立重演 + 不可篡改)', () => {
  const trace = {
    moduleName: 'credit.approval',
    functionName: 'decide',
    steps: [{ sequence: 1, expression: 'score >= 740', result: 'true', matched: true }],
    finalResult: 'APPROVED',
    executionTimeMs: 0.4,
  };
  const app = DEMO_APPLICANTS.approved;

  it('确定性：同一决策记录 → 同一 SHA-256（64 hex）', async () => {
    const src = buildRuleSource('en', DEFAULT_THRESHOLDS);
    const rec1 = buildDecisionRecord('en', src, app, 'APPROVED', trace);
    const rec2 = buildDecisionRecord('en', src, app, 'APPROVED', trace);
    const h1 = await digestDecision(rec1);
    const h2 = await digestDecision(rec2);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('篡改敏感：改决策 / 改输入 / 改规则 → 哈希都变', async () => {
    const src = buildRuleSource('en', DEFAULT_THRESHOLDS);
    const base = await digestDecision(buildDecisionRecord('en', src, app, 'APPROVED', trace));
    // 改决策
    const decisionChanged = await digestDecision(buildDecisionRecord('en', src, app, 'DECLINED', trace));
    // 改输入（信用分降 1）
    const inputChanged = await digestDecision(
      buildDecisionRecord('en', src, { ...app, creditScore: app.creditScore - 1 }, 'APPROVED', trace),
    );
    // 改规则（阈值变 → 规则文本变）
    const ruleChanged = await digestDecision(
      buildDecisionRecord('en', buildRuleSource('en', { ...DEFAULT_THRESHOLDS, premiumScore: 999 }), app, 'APPROVED', trace),
    );
    expect(decisionChanged).not.toBe(base);
    expect(inputChanged).not.toBe(base);
    expect(ruleChanged).not.toBe(base);
  });

  it('键序无关：record 字段顺序不影响哈希（稳定序列化）', async () => {
    const src = buildRuleSource('en', DEFAULT_THRESHOLDS);
    // buildDecisionRecord 固定字段顺序；stableStringify 内部再按键排序，故等价记录哈希相同。
    const a = await digestDecision(buildDecisionRecord('en', src, app, 'APPROVED', trace));
    const b = await digestDecision(buildDecisionRecord('en', src, { ...app }, 'APPROVED', { ...trace }));
    expect(a).toBe(b);
  });

  it('executionTimeMs 不入哈希：耗时不同但同规则/输入/决策 → 同哈希（可独立重跑核对）', async () => {
    const src = buildRuleSource('en', DEFAULT_THRESHOLDS);
    const fast = await digestDecision(buildDecisionRecord('en', src, app, 'APPROVED', { ...trace, executionTimeMs: 0.4 }));
    const slow = await digestDecision(buildDecisionRecord('en', src, app, 'APPROVED', { ...trace, executionTimeMs: 99.9 }));
    expect(fast).toBe(slow); // 否则"独立重跑会匹配"是假的
  });
});
