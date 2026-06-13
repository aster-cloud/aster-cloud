'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { compile, evaluate, EN_US, ZH_CN, DE_DE } from '@aster-cloud/aster-lang-ts/browser';
import { DecisionTracePanel, type DecisionTrace } from '@/components/policy/decision-trace-panel';
import {
  toDemoLocale,
  buildRuleSource,
  toEvalContext,
  getRuleName,
  computeDecision,
  buildExplanation,
  DEFAULT_THRESHOLDS,
  DEMO_APPLICANTS,
  type DemoLocale,
  type DemoApplicant,
  type Thresholds,
  type Outcome,
  type AdverseReason,
  type CreditExplanation as CreditExplanationModel,
} from '@/config/credit-risk-demo';
import { CreditExplanation } from './credit-explanation';
import { cn } from '@/components/ui';

interface DemoContentProps {
  locale: string;
}

const LEXICONS: Record<DemoLocale, unknown> = { en: EN_US, zh: ZH_CN, de: DE_DE };

const OUTCOME_STYLES: Record<Outcome, string> = {
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  refer: 'bg-amber-50 text-amber-800 ring-amber-200',
  declined: 'bg-rose-50 text-rose-800 ring-rose-200',
};

/** 一次「重跑」的结果：决策来自真实引擎，trace 来自客户端镜像。 */
interface RunResult {
  decision: string;
  outcome: Outcome;
  adverseReason: AdverseReason | null;
  trace: DecisionTrace;
  /** 确定性解释模型（值已代入，不经 LLM）。 */
  explanation: CreditExplanationModel;
}

export function DemoContent({ locale }: DemoContentProps) {
  const t = useTranslations('demoPage');
  const loc = toDemoLocale(locale);

  // 申请人输入（可改）+ 关键阈值（可改）。改任一项 → 规则源码与重跑结果随之变化。
  const [applicant, setApplicant] = useState<DemoApplicant>(DEMO_APPLICANTS.approved);
  const [presetKey, setPresetKey] = useState<keyof typeof DEMO_APPLICANTS | null>('approved');
  const [thresholds, setThresholds] = useState<Thresholds>(DEFAULT_THRESHOLDS);
  const [run, setRun] = useState<RunResult | null>(null);

  // 规则源码：随当前阈值实时重建（改阈值 → 规则文本立刻变），证明展示的就是要执行的。
  const ruleSource = useMemo(() => buildRuleSource(loc, thresholds), [loc, thresholds]);

  function pickPreset(key: keyof typeof DEMO_APPLICANTS) {
    setApplicant(DEMO_APPLICANTS[key]);
    setPresetKey(key);
    setRun(null); // 换输入 → 旧结果作废，必须重跑
  }

  function editApplicant(patch: Partial<DemoApplicant>) {
    setApplicant((a) => ({ ...a, ...patch }));
    setPresetKey(null); // 手改 → 脱离预设
    setRun(null);
  }

  function editThreshold(patch: Partial<Thresholds>) {
    setThresholds((th) => ({ ...th, ...patch }));
    setRun(null);
  }

  // 「重跑」：用真实浏览器引擎编译当前规则 + 执行当前申请人，决策以引擎为准。
  function rerun() {
    const result = compile(ruleSource, { lexicon: LEXICONS[loc] } as Parameters<typeof compile>[1]);
    if (!result.core) {
      setRun(null);
      return;
    }
    const ev = evaluate(result.core, getRuleName(loc), toEvalContext(loc, applicant));
    const mirror = computeDecision(loc, applicant, thresholds);
    const engineDecision = ev.success ? String(ev.value) : mirror.decision;
    setRun({
      decision: engineDecision,
      outcome: mirror.outcome,
      adverseReason: mirror.adverseReason,
      trace: { ...mirror.trace, executionTimeMs: ev.executionTimeMs ?? mirror.trace.executionTimeMs },
      explanation: buildExplanation(loc, applicant, thresholds),
    });
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:py-16">
      {/* 标题区 */}
      <div className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{t('eyebrow')}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-fg-muted">{t('subtitle')}</p>
      </div>

      {/* 步骤 1：信贷规则（随阈值实时重建，只读展示） */}
      <section className="mb-8">
        <StepHeading n={1} title={t('step1.title')} />
        <p className="mb-3 text-sm text-fg-muted">{t('step1.hint')}</p>
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-100">
          {ruleSource}
        </pre>
      </section>

      {/* 步骤 2：选申请人 + 改输入 */}
      <section className="mb-8">
        <StepHeading n={2} title={t('step2.title')} />
        <p className="mb-3 text-sm text-fg-muted">{t('step2.hint')}</p>
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {(Object.keys(DEMO_APPLICANTS) as (keyof typeof DEMO_APPLICANTS)[]).map((key) => (
            <button
              key={key}
              onClick={() => pickPreset(key)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                presetKey === key
                  ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                  : 'border-border bg-bg hover:bg-bg-subtle',
              )}
            >
              <div className="font-mono text-xs text-fg-subtle">{DEMO_APPLICANTS[key].id}</div>
              <div className="mt-1 text-sm font-semibold text-fg">{t(`scenarios.${key}.label`)}</div>
              <div className="mt-1 text-xs text-fg-muted">
                {t('fields.creditScore')} {DEMO_APPLICANTS[key].creditScore}
              </div>
            </button>
          ))}
        </div>
        {/* 可编辑申请人字段 */}
        <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-bg-subtle p-4 sm:grid-cols-4">
          <NumberField label={t('fields.creditScore')} value={applicant.creditScore} step={1}
            onChange={(v) => editApplicant({ creditScore: v })} />
          <NumberField label={t('fields.monthlyIncome')} value={applicant.monthlyIncome} step={100} prefix="$"
            onChange={(v) => editApplicant({ monthlyIncome: v })} />
          <NumberField label={t('fields.monthlyDebt')} value={applicant.monthlyDebt} step={100} prefix="$"
            onChange={(v) => editApplicant({ monthlyDebt: v })} />
          <NumberField label={t('fields.requestedAmount')} value={applicant.requestedAmount} step={1000} prefix="$"
            onChange={(v) => editApplicant({ requestedAmount: v })} />
        </div>
      </section>

      {/* 步骤 3：改阈值（改规则） */}
      <section className="mb-8">
        <StepHeading n={3} title={t('step3.title')} />
        <p className="mb-3 text-sm text-fg-muted">{t('step3.hint')}</p>
        <div className="grid grid-cols-2 gap-4 rounded-lg border border-border bg-bg-subtle p-4 sm:grid-cols-3">
          <NumberField label={t('thresholds.premiumScore')} value={thresholds.premiumScore} step={1}
            onChange={(v) => editThreshold({ premiumScore: v })} />
          <NumberField label={t('thresholds.premiumDti')} value={thresholds.premiumDti} step={0.01}
            onChange={(v) => editThreshold({ premiumDti: v })} />
          <NumberField label={t('thresholds.standardScore')} value={thresholds.standardScore} step={1}
            onChange={(v) => editThreshold({ standardScore: v })} />
          <NumberField label={t('thresholds.standardDti')} value={thresholds.standardDti} step={0.01}
            onChange={(v) => editThreshold({ standardDti: v })} />
          <NumberField label={t('thresholds.minScore')} value={thresholds.minScore} step={1}
            onChange={(v) => editThreshold({ minScore: v })} />
          <NumberField label={t('thresholds.maxLti')} value={thresholds.maxLti} step={0.5}
            onChange={(v) => editThreshold({ maxLti: v })} />
          <div className="flex items-end">
            <button
              onClick={() => { setThresholds(DEFAULT_THRESHOLDS); setRun(null); }}
              className="text-xs font-medium text-fg-subtle underline-offset-2 hover:text-fg hover:underline"
            >
              {t('thresholds.reset')}
            </button>
          </div>
        </div>
      </section>

      {/* 步骤 4：重跑 → 决策 */}
      <section className="mb-8">
        <StepHeading n={4} title={t('step4.title')} />
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <button
            onClick={rerun}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
          >
            <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
              <path d="M4 4.5v11l9-5.5-9-5.5z" />
            </svg>
            {t('runButton')}
          </button>
          {run && (
            <div className="text-right">
              <div className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t('decisionLabel')}</div>
              <div className={cn('mt-1 inline-flex items-center rounded-full px-3 py-1 text-base font-semibold ring-1', OUTCOME_STYLES[run.outcome])}>
                {run.decision}
              </div>
            </div>
          )}
        </div>
        {!run && <p className="mt-3 text-sm text-fg-muted">{t('runHint')}</p>}
      </section>

      {/* 步骤 5：回放（DecisionTracePanel）—— 杀手卖点 */}
      {run && (
        <section className="mb-8">
          <StepHeading n={5} title={t('replayTitle')} />

          {/* 不利决策理由（adverse-action）——拒贷/转人工的法律披露物。 */}
          {run.adverseReason && (
            <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <div className="flex items-start gap-3">
                <svg className="mt-0.5 size-5 flex-shrink-0 text-amber-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">{t('adverse.label')}</div>
                  <p className="mt-1 text-sm font-medium text-amber-900">
                    {t(`adverse.reasons.${run.adverseReason.reasonKey}`, {
                      actual: run.adverseReason.actual,
                      threshold: run.adverseReason.threshold,
                    })}
                  </p>
                  <p className="mt-1.5 text-xs text-amber-700">{t('adverse.note')}</p>
                </div>
              </div>
            </div>
          )}

          <p className="mb-4 rounded-md bg-primary-subtle px-4 py-3 text-sm text-fg">{t('step4.auditorNote')}</p>

          {/* 确定性决策解释（值已代入，不经 LLM）——这才是「为什么是这个决策」的准确答案。 */}
          <div className="mb-4">
            <h3 className="mb-1 text-sm font-semibold text-fg">{t('explanation.heading')}</h3>
            <p className="mb-3 text-xs text-fg-muted">{t('explanation.sub')}</p>
            <CreditExplanation explanation={run.explanation} />
          </div>

          {/* 原始执行轨迹（事实已在上方确定性给出，这里是逐步的执行佐证）。 */}
          <DecisionTracePanel trace={run.trace} />
        </section>
      )}

      {/* CTA */}
      <div className="mt-12 rounded-xl border border-border bg-bg-subtle p-6 text-center">
        <p className="text-lg font-semibold text-fg">{t('cta.title')}</p>
        <p className="mt-1 text-sm text-fg-muted">{t('cta.subtitle')}</p>
        <a
          href={`/${locale}/login`}
          className="mt-4 inline-flex items-center rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
        >
          {t('cta.button')}
        </a>
      </div>
    </div>
  );
}

function StepHeading({ n, title }: { n: number; title: string }) {
  return (
    <h2 className="mb-2 text-sm font-semibold text-fg">
      <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{n}</span>
      {title}
    </h2>
  );
}

function NumberField({
  label, value, onChange, step = 1, prefix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  prefix?: string;
}) {
  return (
    <label className="block">
      <span className="text-xs text-fg-subtle">{label}</span>
      <div className="mt-1 flex items-center rounded-md border border-border bg-bg focus-within:ring-1 focus-within:ring-primary">
        {prefix && <span className="pl-2 text-sm text-fg-subtle">{prefix}</span>}
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          className="w-full bg-transparent px-2 py-1.5 font-mono text-sm font-medium text-fg outline-none"
        />
      </div>
    </label>
  );
}
