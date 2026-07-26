'use client';

/**
 * 「原创歌词即源码」demo（《孤勇》，中文彩蛋）——原创押韵短诗逐字即 `.aster` 源码。
 *
 * 范式 = alias-literal（源码即诗 + 字面量宏）+ LayoutMap（显示/编译解耦）（同静夜思）：
 * 一段**原创**押韵短诗按词序即源码；关键词别名把每句领字变结构关键词，**字面量宏**把末句触发词
 * 就地展开成一句押韵主题句；运行入口规则输出该句。LayoutMap 让源码**显示**为工整押韵短诗（语法
 * 脚手架隐进标点/换行）、**编译**走带空格规范源码。
 *
 * 保留一点互动：三个原创触发词变体（不回头/不停走/不弃守）可切换——切换即换源码末词与对应字面量宏，
 * 点运行后引擎真编译 + 真展开该变体的主题句。每个都是真实字面量宏（引擎真展开），非页面预置文案。
 *
 * 诚实分离：三视图（意境展示 / 实际编译源码 toCanonical / 规范关键词等价版），佐证「读的是诗、跑的是规范源码」。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  compile,
  evaluate,
  canonicalize,
  vocabularyRegistry,
  initBuiltinVocabularies,
} from '@aster-cloud/aster-lang-ts/browser';
import { GUYONG } from '@/config/guyong-demo';
import { toCanonical, toDisplay } from '@/lib/layout-map';
import { GuyongMelodyPlayer } from './guyong-melody';
import { cn } from '@/components/ui';

interface RunResult {
  trigger: string;
  /** evaluate 入口规则的真实返回（= 字面量宏展开的主题句）。 */
  woven: string;
  /** 诗体源码经 canonicalize 的真实输出（字面量宏就地展开的引擎产物，非 config 手写）。 */
  canonicalized: string;
}

export function GuyongDemoContent() {
  // 当前触发词变体（保留一点互动）。
  const [variantIdx, setVariantIdx] = useState(0);
  const variant = GUYONG.variants[variantIdx]!;

  // 三视图（诚实分离）：意境展示 = toDisplay / 实际编译源码 = toCanonical(= source) / 规范关键词等价版。
  const layout = GUYONG.layoutFor(variant);
  const displaySource = toDisplay(layout);
  const compileSource = toCanonical(layout);
  const canonicalKeyword = GUYONG.canonicalFor(variant);
  const [view, setView] = useState<'display' | 'compile' | 'canonical'>('display');
  const VIEW_LABEL = {
    display: '意境展示（LayoutMap 渲染，非逐字源码）',
    compile: '实际编译源码（toCanonical，真正喂给引擎的）',
    canonical: '规范关键词等价版（证明语义等价，非实际编译输入）',
  } as const;
  const VIEW_TEXT = { display: displaySource, compile: compileSource, canonical: canonicalKeyword };

  // 编译当前变体（先注册该变体的字面量宏词汇，再带 domain 编译）。变体切换即重编译。
  const compiled = useMemo(() => {
    initBuiltinVocabularies();
    const vocab = GUYONG.vocabFor(variant);
    vocabularyRegistry.registerCustom(vocab.id, vocab);
    const r = compile(compileSource, {
      lexicon: GUYONG.lexicon,
      domain: GUYONG.domain,
      tenantId: GUYONG.domain,
    });
    const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
    return { core: r.core, ok: r.success && errs.length === 0, errs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variantIdx]);

  const [run, setRun] = useState<RunResult | null>(null);
  // 结果绑定其所属触发词：切换变体后旧结果失效（render 期守卫，避免 set-state-in-effect）。
  const result = run && run.trigger === variant.trigger ? run : null;

  // ── 原创旋律播放（纯 Web Audio，零外部资源）──────────────────────────────────
  // 播放器持久于 ref（跨 render 不重建）；singingLine = 当前正在唱的诗行（跟唱高亮），null = 未播放。
  const playerRef = useRef<GuyongMelodyPlayer | null>(null);
  const [singingLine, setSingingLine] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  // 客户端挂载后惰性建播放器（不在 render 期碰 ref）；卸载时停止音频（防残响 / 泄漏 AudioContext）。
  useEffect(() => {
    playerRef.current = new GuyongMelodyPlayer((line) => {
      setSingingLine(line);
      if (line === null) setPlaying(false);
    });
    return () => playerRef.current?.stop();
  }, []);

  function toggleMelody() {
    const p = playerRef.current;
    if (!p) return;
    if (p.isPlaying) {
      p.stop();
      setPlaying(false);
    } else {
      p.play();
      setPlaying(true);
    }
  }

  // 显示层按行拆分，供跟唱高亮（仅「意境展示」视图有诗行结构；其余视图不高亮）。
  const displayLines = displaySource.split('\n');

  // alias-literal 单次运行：① canonicalize 真实输出（字面量宏就地展开的引擎产物）② evaluate 真实返回。
  function runOnce() {
    if (!compiled.core) return;
    const canonicalized = canonicalize(compileSource, {
      lexicon: GUYONG.lexicon,
      domain: GUYONG.domain,
      locale: GUYONG.lexicon.id,
      tenantId: GUYONG.domain,
    });
    const ev = evaluate(compiled.core, GUYONG.entry, {});
    setRun({
      trigger: variant.trigger,
      woven: ev.success ? String(ev.value) : '—',
      canonicalized,
    });
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">{GUYONG.title}</h1>
        <p className="mt-2 text-sm text-fg-muted">{GUYONG.attribution}</p>
      </header>

      {/* 诗体源码 · 三视图 */}
      <div className="rounded-lg border border-border bg-bg-subtle p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-medium text-fg-muted">{VIEW_LABEL[view]}</span>
          <div className="flex gap-1">
            {(['display', 'compile', 'canonical'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={cn(
                  'rounded px-2 py-0.5 text-xs',
                  view === v ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:text-accent',
                )}
              >
                {v === 'display' ? '意境' : v === 'compile' ? '编译源码' : '规范版'}
              </button>
            ))}
          </div>
          {/* 原创旋律播放（纯 Web Audio，零外部资源）。播放时「意境」视图逐行跟唱高亮。 */}
          <button
            type="button"
            onClick={toggleMelody}
            aria-pressed={playing}
            className={cn(
              'inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs',
              playing ? 'bg-accent/15 text-accent' : 'text-fg-muted hover:text-accent',
            )}
          >
            <span aria-hidden>{playing ? '⏸' : '♪'}</span>
            {playing ? '停止旋律' : '播放旋律'}
          </button>
        </div>
        {view === 'display' ? (
          // 意境视图：按诗行渲染，播放时高亮当前唱到的行（跟唱）。
          <div className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-relaxed">
            {displayLines.map((line, i) => (
              <div
                key={i}
                className={cn(
                  'transition-colors',
                  singingLine === i ? 'rounded bg-accent/15 text-accent' : 'text-fg',
                )}
              >
                {line || ' '}
              </div>
            ))}
          </div>
        ) : (
          <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-fg">
            {VIEW_TEXT[view]}
          </pre>
        )}
      </div>

      {!compiled.ok && (
        <p className="mt-3 text-xs text-danger">
          源码编译失败：{compiled.errs.map((e) => e.message).join('; ')}
        </p>
      )}

      {/* 切换触发词（保留一点互动） */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-fg">切换末句的触发词，运行看引擎真展开</h2>
        <p className="mb-4 text-sm text-fg-muted">
          每个触发词都是一个<strong className="text-fg">字面量宏</strong>：源码里只有触发词，运行时引擎把它
          就地展开成一句押韵主题句。切换后点「运行」，看引擎当场编译并展开。
        </p>
        <div className="flex flex-wrap gap-3">
          {GUYONG.variants.map((v, i) => (
            <button
              key={v.trigger}
              type="button"
              onClick={() => setVariantIdx(i)}
              className={cn(
                'rounded-lg border px-5 py-3 text-sm font-medium transition-colors',
                i === variantIdx
                  ? 'border-accent bg-accent/10 text-fg'
                  : 'border-border bg-bg-subtle text-fg-muted hover:border-accent/50',
              )}
            >
              {v.trigger}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={runOnce}
          disabled={!compiled.core}
          className={cn(
            'mt-4 rounded-lg border px-6 py-3 text-sm font-medium transition-colors',
            result
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border bg-bg-subtle text-fg hover:border-accent/50',
            !compiled.core && 'cursor-not-allowed opacity-50',
          )}
        >
          运行《孤勇》· {variant.trigger}
        </button>
      </section>

      {/* 运行结果 · 引擎实况 */}
      {result && (
        <section className="mt-6 rounded-xl border border-border bg-bg-subtle p-6">
          <p className="mb-4 text-sm font-semibold text-fg">引擎实况：编译 → 求值</p>

          {/* ① canonicalize 真实展开（引擎产物） */}
          <p className="mb-2 text-xs font-semibold text-fg-subtle">
            ① canonicalize 的真实输出（引擎产物，非写死）——末句触发词「{variant.trigger}」已被字面量宏就地展开
          </p>
          <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-4 font-mono text-xs leading-relaxed text-fg-muted">
            {result.canonicalized}
          </pre>

          {/* ② evaluate 入口规则的真实返回 */}
          <p className="mt-5 mb-2 text-xs font-semibold text-fg-subtle">② evaluate 入口规则「归途」的真实返回</p>
          <p className="font-display text-2xl leading-relaxed text-fg">{result.woven}</p>

          <p className="mt-5 text-sm text-fg-muted">
            这句主题句由字面量宏在表层把触发词「{variant.trigger}」展开而来（见上方 canonicalize 产物），
            再由规则当场求值输出——不是页面预置的固定文案。
          </p>
        </section>
      )}

      <footer className="mt-8 rounded-lg border border-border bg-bg-subtle p-4 text-xs leading-relaxed text-fg-muted">
        <p>
          这段源码是<strong className="text-fg">本项目原创的押韵短诗</strong>（从零创作，非任何既有歌曲）——
          关键词别名把每句领字变结构关键词，<strong className="text-fg">字面量宏</strong>把末句触发词就地展开成
          一句押韵主题句，运行入口规则输出该句。
          <strong className="text-fg">LayoutMap</strong> 把 <code>记着</code>/<code>是</code>/<code>答一句</code> 等语法脚手架隐进标点换行，
          让你读到的是工整押韵的短诗，引擎编译的是带空格规范源码——
          二者逐字对应（<strong className="text-fg">toCanonical(layout) === source</strong>），
          歌词体版与规范关键词版编译出<strong className="text-fg">完全一致的 Core IR</strong>。
          底层与信贷 demo 同一套可证明的执行链。
        </p>
      </footer>
    </div>
  );
}
