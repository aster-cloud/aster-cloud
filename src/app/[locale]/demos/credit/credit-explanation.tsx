'use client';

import { useTranslations } from 'next-intl';
import type { CreditExplanation } from '@/config/credit-risk-demo';
import { cn } from '@/components/ui';

/**
 * 确定性信贷决策解释。
 *
 * 关键：所有事实（字段值、中间指标、逐步判断、最终理由）都来自 `buildExplanation()`，
 * 已把规则/阈值/申请人值代入，数字保证 100% 正确——不经过 LLM。此前依赖 LLM 引用 trace
 * 数值，模型会吐出空值模板（"信用分 ││"），故事实绝不交给模型，仅事实之上的散文叙述
 * 可选交给 AI。
 */
export function CreditExplanation({ explanation }: { explanation: CreditExplanation }) {
  const t = useTranslations('demoPage.explanation');

  return (
    <div className="space-y-5 rounded-lg border border-border bg-bg p-4 text-sm">
      {/* 概览 */}
      <section>
        <h4 className="mb-2 font-semibold text-fg">{t('overviewHeading')}</h4>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-fg-muted">
          <dt className="text-fg-subtle">{t('module')}</dt>
          <dd className="font-mono text-fg">{explanation.moduleName}</dd>
          <dt className="text-fg-subtle">{t('rule')}</dt>
          <dd className="font-mono text-fg">{explanation.ruleName}</dd>
          <dt className="text-fg-subtle">{t('decision')}</dt>
          <dd className="font-semibold text-fg">{explanation.decision}</dd>
        </dl>
      </section>

      {/* 字段说明 */}
      <section>
        <h4 className="mb-2 font-semibold text-fg">{t('fieldsHeading')}</h4>
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-border text-left text-fg-subtle">
                <th className="py-1.5 pr-3 font-medium">{t('colField')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('colType')}</th>
                <th className="py-1.5 pr-3 font-medium">{t('colValue')}</th>
                <th className="py-1.5 font-medium">{t('colPurpose')}</th>
              </tr>
            </thead>
            <tbody>
              {explanation.fields.map((f) => (
                <tr key={f.name} className="border-b border-border/60">
                  <td className="py-1.5 pr-3 font-mono text-fg">{f.name}</td>
                  <td className="py-1.5 pr-3 text-fg-muted">{f.type}</td>
                  <td className="py-1.5 pr-3 font-mono font-medium text-fg">{f.value}</td>
                  <td className="py-1.5 text-fg-muted">{f.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* 中间指标 */}
      <section>
        <h4 className="mb-2 font-semibold text-fg">{t('metricsHeading')}</h4>
        <ul className="space-y-1.5">
          {explanation.metrics.map((m) => (
            <li key={m.name} className="font-mono text-xs text-fg-muted">
              <span className="font-semibold text-fg">{m.name}</span> = {m.formula} = {m.computation} ={' '}
              <span className="font-semibold text-fg">{m.result}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* 逐步判断 */}
      <section>
        <h4 className="mb-2 font-semibold text-fg">{t('stepsHeading')}</h4>
        <ol className="space-y-2">
          {explanation.tiers.map((tier, i) => (
            <li key={i} className="border-l-2 border-border pl-3">
              <div className="flex items-center gap-2">
                <span className="font-medium text-fg">{tier.title}</span>
                {tier.evaluated ? (
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                      tier.matched ? 'bg-emerald-50 text-emerald-700' : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400',
                    )}
                  >
                    {tier.matched ? t('matched') : t('notMatched')}
                  </span>
                ) : (
                  <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] font-medium text-zinc-400 dark:bg-zinc-800">
                    {t('skipped')}
                  </span>
                )}
              </div>
              <p className="mt-0.5 font-mono text-xs text-fg-muted">{tier.detail}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 最终理由 */}
      <section className="rounded-md bg-primary-subtle px-3 py-2.5">
        <span className="font-semibold text-fg">{t('reasonHeading')}：</span>
        <span className="text-fg">{explanation.oneLineReason}</span>
      </section>
    </div>
  );
}
