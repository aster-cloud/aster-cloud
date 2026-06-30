'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import { POEMS, reciteLines, toPoemLocale } from '@/config/poem-demo';
import { cn } from '@/components/ui';

export function PoemDemoContent({ locale }: { locale: string }) {
  const t = useTranslations('poemDemoPage');
  const poem = POEMS[toPoemLocale(locale)];
  // 吟诵结果连同其所属诗一起存：诗变了（切语言）旧结果即失效（render 期守卫，避免 set-state-in-effect）。
  const [run, setRun] = useState<{ poemId: string; lines: string[] } | null>(null);
  const lines = run && run.poemId === poem.lexicon.id ? run.lines : null;
  const [showCanonical, setShowCanonical] = useState(false);

  // 编译诗体源码（注入该诗的诗词别名词典）→ canonicalize 归一回规范关键词 → 同款引擎编译。
  const core = useMemo(() => {
    const r = compile(poem.source, { lexicon: poem.lexicon });
    return r.core ?? null;
  }, [poem]);

  function recite() {
    if (!core) return;
    const ev = evaluate(core, poem.entry, { [poem.param]: poem.start });
    setRun(ev.success ? { poemId: poem.lexicon.id, lines: reciteLines(poem, String(ev.value)) } : null);
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

      {/* 诗体源码 —— 逐行读是一首（本语言的）名诗 */}
      <section className="mb-8">
        <h2 className="mb-1 text-sm font-semibold text-fg">{t('source.title')}</h2>
        <p className="mb-1 text-sm text-fg-muted">{t('source.hint')}</p>
        <p className="mb-3 text-xs text-fg-subtle">
          <span className="font-display italic text-fg">{poem.title}</span>
          <span> · {poem.attribution}</span>
        </p>
        <pre className="overflow-x-auto rounded-xl border border-border bg-bg-subtle p-5 font-mono text-sm leading-relaxed text-fg">
          {poem.source}
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
              {poem.canonical}
            </pre>
          </div>
        )}
      </section>

      {/* 运行 —— 它真的跑，递归把诗一句句吟出 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">{t('run.title')}</h2>
        <p className="mb-3 text-sm text-fg-muted">{t('run.hint')}</p>
        <button
          onClick={recite}
          disabled={!core}
          className={cn(
            'rounded-lg border px-5 py-3 text-sm font-medium transition-colors',
            lines
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-bg-subtle text-fg hover:border-primary/50',
            !core && 'cursor-not-allowed opacity-50',
          )}
        >
          {t('run.button')}
        </button>
      </section>

      {/* 吟诵结果 */}
      {lines && (
        <section className="mb-8 rounded-xl border border-border bg-bg-subtle p-6">
          <p className="mb-3 text-sm font-semibold text-fg">{t('result.title')}</p>
          <div className="space-y-2 font-display text-lg italic leading-relaxed text-fg">
            {lines.map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
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
