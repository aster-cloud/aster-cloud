'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { DecisionTracePanel } from '@/components/policy/decision-trace-panel';
import { getCreditRiskRule, getDemoScenarios, type DemoScenario } from '@/config/credit-risk-demo';
import { cn } from '@/components/ui';

interface DemoContentProps {
  locale: string;
}

const OUTCOME_STYLES: Record<DemoScenario['outcome'], string> = {
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  refer: 'bg-amber-50 text-amber-800 ring-amber-200',
  declined: 'bg-rose-50 text-rose-800 ring-rose-200',
};

export function DemoContent({ locale }: DemoContentProps) {
  const t = useTranslations('demoPage');
  // 按当前语言取规则源码 + 场景（中文站显示中文规则，德文站显示德文规则）。
  const rule = getCreditRiskRule(locale);
  const scenarios = getDemoScenarios(locale);
  const [selected, setSelected] = useState<DemoScenario>(scenarios[0]);
  const [replayed, setReplayed] = useState(false);

  function pickScenario(s: DemoScenario) {
    setSelected(s);
    setReplayed(false); // 切场景重置回放，让用户重新「按下回放」
  }

  const a = selected.applicant;

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

      {/* 步骤 1：信贷规则（只读展示，证明规则可读可审） */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">
          <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</span>
          {t('step1.title')}
        </h2>
        <p className="mb-3 text-sm text-fg-muted">{t('step1.hint')}</p>
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-100">
          {rule}
        </pre>
      </section>

      {/* 步骤 2：选一个申请人 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">
          <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">2</span>
          {t('step2.title')}
        </h2>
        <p className="mb-3 text-sm text-fg-muted">{t('step2.hint')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {scenarios.map((s) => (
            <button
              key={s.key}
              onClick={() => pickScenario(s)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                selected.key === s.key
                  ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                  : 'border-border bg-bg hover:bg-bg-subtle',
              )}
            >
              <div className="font-mono text-xs text-fg-subtle">{s.applicant.id}</div>
              <div className="mt-1 text-sm font-semibold text-fg">{t(`scenarios.${s.key}.label`)}</div>
              <div className="mt-1 text-xs text-fg-muted">
                {t('fields.creditScore')} {s.applicant.creditScore}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 选中申请人的明细 */}
      <section className="mb-8 rounded-lg border border-border bg-bg-subtle p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <Field label={t('fields.creditScore')} value={String(a.creditScore)} />
          <Field label={t('fields.monthlyIncome')} value={`$${a.monthlyIncome.toLocaleString()}`} />
          <Field label={t('fields.monthlyDebt')} value={`$${a.monthlyDebt.toLocaleString()}`} />
          <Field label={t('fields.requestedAmount')} value={`$${a.requestedAmount.toLocaleString()}`} />
        </div>
      </section>

      {/* 步骤 3：决策结果 + 回放按钮 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">
          <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">3</span>
          {t('step3.title')}
        </h2>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t('decisionLabel')}</div>
            <div className={cn('mt-1 inline-flex items-center rounded-full px-3 py-1 text-base font-semibold ring-1', OUTCOME_STYLES[selected.outcome])}>
              {selected.decision}
            </div>
          </div>
          {!replayed && (
            <button
              onClick={() => setReplayed(true)}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
            >
              <svg className="size-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
                <path d="M4 4.5v11l9-5.5-9-5.5z" />
              </svg>
              {t('replayButton')}
            </button>
          )}
        </div>
      </section>

      {/* 步骤 4：回放（DecisionTracePanel）—— 杀手卖点 */}
      {replayed && (
        <section className="mb-8">
          <h2 className="mb-2 text-sm font-semibold text-fg">
            <span className="mr-2 inline-flex size-5 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">4</span>
            {t('step4.title')}
          </h2>
          <p className="mb-4 rounded-md bg-primary-subtle px-4 py-3 text-sm text-fg">{t('step4.auditorNote')}</p>
          <DecisionTracePanel trace={selected.trace} source={rule} locale={locale} />
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-fg-subtle">{label}</div>
      <div className="mt-0.5 font-mono text-sm font-medium text-fg">{value}</div>
    </div>
  );
}
