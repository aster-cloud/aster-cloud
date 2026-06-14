'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import {
  VOCAB_DOMAINS,
  VOCAB_DOMAIN_IDS,
  VOCAB_DEMO_TENANT,
  registerVocabForDomain,
  lexiconFor,
  toDemoLocale,
  type VocabDomainId,
} from '@/config/vocab-demo';
import { cn } from '@/components/ui';

interface RunResult {
  caseId: string;
  decision: string;
  ok: boolean;
}

export function VocabDemoContent({ locale }: { locale: string }) {
  const t = useTranslations('vocabDemoPage');
  const loc = toDemoLocale(locale);
  const [domainId, setDomainId] = useState<VocabDomainId>('healthcare');
  const [run, setRun] = useState<RunResult | null>(null);

  const domain = VOCAB_DOMAINS[domainId];
  const rule = domain.rules[loc];

  // 编译该领域规则（按当前语言）：注入对应 locale 的领域词汇 → compile 翻成 canonical IR。
  const core = useMemo(() => {
    const domainKey = registerVocabForDomain(domain, loc);
    const r = compile(rule.source, {
      lexicon: lexiconFor(loc),
      domain: domainKey,
      tenantId: VOCAB_DEMO_TENANT,
    } as Parameters<typeof compile>[1]);
    return r.core ?? null;
  }, [domain, rule, loc]);

  function pickDomain(id: VocabDomainId) {
    setDomainId(id);
    setRun(null);
  }

  // 运行案例：eval 输入用 canonical 字段名（领域词只在表层，IR 是规范名）。
  function runCase(caseId: string) {
    const c = domain.cases.find((x) => x.id === caseId);
    if (!c || !core) return;
    const ev = evaluate(core, rule.ruleName, { [rule.paramName]: c.input });
    setRun({ caseId, decision: ev.success ? String(ev.value) : c.expect[loc], ok: ev.success });
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

      {/* 步骤 1：选领域 */}
      <section className="mb-8">
        <StepHeading n={1} title={t('step1.title')} />
        <p className="mb-3 text-sm text-fg-muted">{t('step1.hint')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {VOCAB_DOMAIN_IDS.map((id) => (
            <button
              key={id}
              onClick={() => pickDomain(id)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                domainId === id
                  ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                  : 'border-border bg-bg hover:bg-bg-subtle',
              )}
            >
              <div className="text-sm font-semibold text-fg">{t(`domains.${id}.name`)}</div>
              <div className="mt-1 text-xs text-fg-muted">{t(`domains.${id}.tagline`)}</div>
            </button>
          ))}
        </div>
      </section>

      {/* 步骤 2：领域术语表（行业词用当前语言） */}
      <section className="mb-8">
        <StepHeading n={2} title={t('step2.title')} />
        <p className="mb-3 text-sm text-fg-muted">{t('step2.hint')}</p>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-bg-subtle">
              <tr>
                <Th>{t('terms.colIndustry')}</Th>
                <Th>{t('terms.colCanonical')}</Th>
                <Th>{t('terms.colKind')}</Th>
                <Th>{t('terms.colGloss')}</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {domain.terms.map((term) => (
                <tr key={term.canonical}>
                  <td className="px-4 py-2 font-mono font-medium text-sky-700 dark:text-sky-400">{term.localized[loc]}</td>
                  <td className="px-4 py-2 font-mono text-xs text-fg-muted">{term.canonical}</td>
                  <td className="px-4 py-2 text-xs text-fg-muted">{t(`terms.kind.${term.kind}`)}</td>
                  <td className="px-4 py-2 text-fg-muted">{t(`glosses.${term.canonical}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-fg-subtle">{t('terms.note')}</p>
      </section>

      {/* 步骤 3：用行业术语 + 当前语言 CNL 写的规则 */}
      <section className="mb-8">
        <StepHeading n={3} title={t('step3.title')} />
        <p className="mb-3 text-sm text-fg-muted">{t('step3.hint')}</p>
        <pre className="overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm leading-relaxed text-zinc-100">
          {rule.source}
        </pre>
      </section>

      {/* 步骤 4：选案例运行 */}
      <section className="mb-8">
        <StepHeading n={4} title={t('step4.title')} />
        <p className="mb-3 text-sm text-fg-muted">{t('step4.hint')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {domain.cases.map((c) => (
            <button
              key={c.id}
              onClick={() => runCase(c.id)}
              className={cn(
                'rounded-lg border p-4 text-left transition-colors',
                run?.caseId === c.id
                  ? 'border-primary bg-primary-subtle ring-1 ring-primary'
                  : 'border-border bg-bg hover:bg-bg-subtle',
              )}
            >
              <div className="font-mono text-xs text-fg-subtle">{c.id}</div>
              <div className="mt-1 text-sm font-semibold text-fg">{t(`domains.${domainId}.cases.${c.labelKey}`)}</div>
              <div className="mt-1 space-y-0.5 text-xs text-fg-muted">
                {Object.entries(c.input).map(([k, v]) => (
                  <div key={k} className="font-mono">{k}: {v}</div>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      {/* 决策结果 */}
      {run && (
        <section className="mb-8 rounded-xl border border-border bg-bg-subtle p-5">
          <div className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{t('result.label')}</div>
          <div className="mt-2 inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-base font-semibold text-emerald-800 ring-1 ring-emerald-200">
            {run.decision}
          </div>
          <p className="mt-3 text-sm text-fg-muted">{t('result.note')}</p>
        </section>
      )}

      {/* CTA */}
      <div className="mt-12 rounded-xl border border-border bg-bg-subtle p-6 text-center">
        <p className="text-lg font-semibold text-fg">{t('cta.title')}</p>
        <p className="mt-1 text-sm text-fg-muted">{t('cta.subtitle')}</p>
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

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-fg-subtle">
      {children}
    </th>
  );
}
