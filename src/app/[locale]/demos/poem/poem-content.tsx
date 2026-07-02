'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { compile, evaluate, vocabularyRegistry, initBuiltinVocabularies } from '@aster-cloud/aster-lang-ts/browser';
import { POEMS, toPoemLocale } from '@/config/poem-demo';
import { cn } from '@/components/ui';

interface RunResult {
  poemId: string;
  input: number;
  woven: string;
  computed: string;
}

export function PoemDemoContent({ locale }: { locale: string }) {
  const t = useTranslations('poemDemoPage');
  const poem = POEMS[toPoemLocale(locale)];
  // 结果连同其所属诗一起存：诗变了（切语言）旧结果即失效（render 期守卫，避免 set-state-in-effect）。
  const [run, setRun] = useState<RunResult | null>(null);
  const result = run && run.poemId === poem.lexicon.id ? run : null;
  const [showCanonical, setShowCanonical] = useState(false);

  // 编译诗体源码（注入诗词别名词典）→ canonicalize 归一回规范关键词 → 同款引擎编译。
  // alias-literal 范式（《静夜思》）还需先注册字面量宏词汇表，并以 domain/tenantId 触发展开。
  const core = useMemo(() => {
    if (poem.vocab) {
      initBuiltinVocabularies();
      vocabularyRegistry.registerCustom(poem.vocab.id, poem.vocab);
      const r = compile(poem.source, {
        lexicon: poem.lexicon,
        domain: poem.vocab.id,
        tenantId: poem.vocab.id,
      });
      return r.core ?? null;
    }
    const r = compile(poem.source, { lexicon: poem.lexicon });
    return r.core ?? null;
  }, [poem]);

  // 运行入口 rule：computed 范式按 input 算出整首诗；alias-literal 范式恒输出诗名。
  function runAt(input: number) {
    if (!core) return;
    const sample = poem.samples.find((s) => s.input === input);
    const ev = evaluate(core, poem.entry, { [poem.param]: input });
    setRun({
      poemId: poem.lexicon.id,
      input,
      woven: ev.success ? String(ev.value) : '—',
      computed: sample?.computed ?? '',
    });
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

      {/* 诗体源码 —— 上半诗句，下半真计算 */}
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

      {/* 运行 —— 代入一个 input：computed 范式计算织出整首诗，alias-literal 范式恒输出诗名 */}
      <section className="mb-8">
        <h2 className="mb-2 text-sm font-semibold text-fg">{t('run.title')}</h2>
        <p className="mb-3 text-sm text-fg-muted">{t('run.hint')}</p>
        <div className="flex flex-wrap gap-3">
          {poem.samples.map((s) => (
            <button
              key={s.input}
              onClick={() => runAt(s.input)}
              disabled={!core}
              className={cn(
                'rounded-lg border px-5 py-3 text-sm font-medium transition-colors',
                result?.input === s.input
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-bg-subtle text-fg hover:border-primary/50',
                !core && 'cursor-not-allowed opacity-50',
              )}
            >
              {t('run.button', { n: s.input })}
            </button>
          ))}
        </div>
      </section>

      {/* 结果 —— 算出的整首诗 + 这一遍背后的计算 */}
      {result && (
        <section className="mb-8 rounded-xl border border-border bg-bg-subtle p-6">
          <p className="mb-3 text-sm font-semibold text-fg">{t('result.title', { n: result.input })}</p>
          <p className="font-display text-xl leading-relaxed text-fg">{result.woven}</p>
          {result.computed && (
            <p className="mt-4 border-l-2 border-primary/40 pl-3 font-mono text-xs text-fg-subtle">
              {result.computed}
            </p>
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
