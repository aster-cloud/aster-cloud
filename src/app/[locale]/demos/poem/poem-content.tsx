'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import { POEMS, toPoemLocale } from '@/config/poem-demo';
import { cn } from '@/components/ui';

interface LineTrace {
  verse: string;
  meaning: string;
  value: string;
}

export function PoemDemoContent({ locale }: { locale: string }) {
  const t = useTranslations('poemDemoPage');
  const poem = POEMS[toPoemLocale(locale)];
  // 求值迹连同其所属诗一起存：诗变了（切语言）旧结果即失效（render 期守卫，避免 set-state-in-effect）。
  const [run, setRun] = useState<{ poemId: string; trace: LineTrace[] } | null>(null);
  const trace = run && run.poemId === poem.lexicon.id ? run.trace : null;
  const [showCanonical, setShowCanonical] = useState(false);

  // 编译诗体源码（注入诗词别名词典）→ canonicalize 归一回规范关键词 → 同款引擎编译。
  const core = useMemo(() => {
    const r = compile(poem.source, { lexicon: poem.lexicon });
    return r.core ?? null;
  }, [poem]);

  // 逐行（逐规则）求值：每句诗代入 sample 跑出它真正算出的值。
  function runPoem() {
    if (!core) return;
    const trace: LineTrace[] = poem.lines.map((line) => {
      const ev = evaluate(core, line.rule, { [poem.param]: poem.sample });
      return { verse: line.verse, meaning: line.meaning, value: ev.success ? String(ev.value) : '—' };
    });
    setRun({ poemId: poem.lexicon.id, trace });
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

      {/* 诗体源码 —— 每行是真代码，不是字符串 */}
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

      {/* 运行 —— 它真的算，逐行出求值迹 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">{t('run.title')}</h2>
        <p className="mb-3 text-sm text-fg-muted">{t('run.hint', { n: poem.sample })}</p>
        <button
          onClick={runPoem}
          disabled={!core}
          className={cn(
            'rounded-lg border px-5 py-3 text-sm font-medium transition-colors',
            trace
              ? 'border-primary bg-primary/10 text-primary'
              : 'border-border bg-bg-subtle text-fg hover:border-primary/50',
            !core && 'cursor-not-allowed opacity-50',
          )}
        >
          {t('run.button', { n: poem.sample })}
        </button>
      </section>

      {/* 逐行求值迹 —— 每句诗算出什么 */}
      {trace && (
        <section className="mb-8 rounded-xl border border-border bg-bg-subtle p-6">
          <p className="mb-4 text-sm font-semibold text-fg">{t('result.title', { n: poem.sample })}</p>
          <ol className="space-y-4">
            {trace.map((line, i) => (
              <li key={i} className="border-l-2 border-primary/40 pl-4">
                <code className="block font-mono text-sm text-fg">{line.verse}</code>
                <p className="mt-1 text-xs text-fg-subtle">{line.meaning}</p>
                <p className="mt-1 font-display text-lg text-primary">
                  = <span className="font-semibold">{line.value}</span>
                </p>
              </li>
            ))}
          </ol>
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
