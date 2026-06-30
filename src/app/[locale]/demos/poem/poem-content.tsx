'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import {
  NIGHTFALL_EN,
  NIGHTFALL_SOURCE,
  NIGHTFALL_CANONICAL,
  NIGHTFALL_ENTRY,
  NIGHTFALL_PARAM,
  NIGHTFALL_CASES,
  reciteLines,
} from '@/config/poem-demo';
import { cn } from '@/components/ui';

interface RunResult {
  stars: number;
  lines: string[];
  ok: boolean;
}

export function PoemDemoContent({ locale: _locale }: { locale: string }) {
  const t = useTranslations('poemDemoPage');
  const [run, setRun] = useState<RunResult | null>(null);
  const [showCanonical, setShowCanonical] = useState(false);

  // 编译诗体源码（注入 NIGHTFALL 别名词典）→ canonicalize 归一回规范关键词 → 同款引擎编译。
  const core = useMemo(() => {
    const r = compile(NIGHTFALL_SOURCE, { lexicon: NIGHTFALL_EN });
    return r.core ?? null;
  }, []);

  function reciteStars(stars: number) {
    if (!core) return;
    const ev = evaluate(core, NIGHTFALL_ENTRY, { [NIGHTFALL_PARAM]: stars });
    const value = ev.success ? String(ev.value) : '';
    setRun({ stars, lines: ev.success ? reciteLines(value) : [], ok: ev.success });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16">
      {/* 标题区 */}
      <div className="mb-10 text-center">
        <p className="text-sm font-semibold uppercase tracking-wide text-primary">{t('eyebrow')}</p>
        <h1 className="mt-2 font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-lg text-fg-muted">{t('subtitle')}</p>
      </div>

      {/* 诗体源码 —— 逐行读是一首诗 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">{t('source.title')}</h2>
        <p className="mb-3 text-sm text-fg-muted">{t('source.hint')}</p>
        <pre className="overflow-x-auto rounded-xl border border-border bg-bg-subtle p-5 font-mono text-sm leading-relaxed text-fg">
          {NIGHTFALL_SOURCE}
        </pre>
        <button
          onClick={() => setShowCanonical((v) => !v)}
          className="mt-3 text-sm font-medium text-primary hover:underline"
        >
          {showCanonical ? t('source.hideCanonical') : t('source.showCanonical')}
        </button>
        {showCanonical && (
          <div className="mt-3">
            <p className="mb-2 text-xs text-fg-subtle">{t('source.canonicalNote')}</p>
            <pre className="overflow-x-auto rounded-xl border border-border bg-bg p-5 font-mono text-sm leading-relaxed text-fg-muted">
              {NIGHTFALL_CANONICAL}
            </pre>
          </div>
        )}
      </section>

      {/* 运行 —— 它真的跑，递归把星光一句句聚拢 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">{t('run.title')}</h2>
        <p className="mb-3 text-sm text-fg-muted">{t('run.hint')}</p>
        <div className="flex flex-wrap gap-3">
          {NIGHTFALL_CASES.map((c) => (
            <button
              key={c.stars}
              onClick={() => reciteStars(c.stars)}
              disabled={!core}
              className={cn(
                'rounded-lg border px-5 py-3 text-sm font-medium transition-colors',
                run?.stars === c.stars
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-bg-subtle text-fg hover:border-primary/50',
                !core && 'cursor-not-allowed opacity-50',
              )}
            >
              {t('run.starsLabel', { count: c.stars })}
            </button>
          ))}
        </div>
      </section>

      {/* 吟诵结果 */}
      {run && (
        <section className="mb-8 rounded-xl border border-border bg-bg-subtle p-6">
          <p className="mb-3 text-sm font-semibold text-fg">
            {t('result.title', { count: run.stars })}
          </p>
          {run.ok ? (
            <div className="space-y-2 font-display text-lg italic leading-relaxed text-fg">
              {run.lines.map((line, i) => (
                <p key={i}>{line}</p>
              ))}
            </div>
          ) : (
            <p className="text-sm text-danger">{t('result.error')}</p>
          )}
          <p className="mt-4 text-sm text-fg-muted">{t('result.note')}</p>
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
