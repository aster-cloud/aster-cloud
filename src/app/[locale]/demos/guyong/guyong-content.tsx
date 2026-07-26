'use client';

/**
 * 「原创歌词即源码」demo（《孤勇》，中文彩蛋）——原创叙事体歌词逐字即 `.aster` 源码。
 *
 * 范式 = 布尔 decision + LayoutMap：三个前提（守/进/记）是**布尔入参**，用户拨动 toggle 即把
 * true/false 直接传给引擎；引擎 令 归心 = 守 并且 进 并且 记，再 如果/否则 真判定输出裁决。
 * 翻任一前提裁决即变——引擎**真推导**，非查表。LayoutMap 让源码**显示**为有意境的中文（语法脚手架
 * 隐进标点/换行）、**编译**走带空格规范源码。一键切「看规范版」佐证歌词体 ≡ 规范版（别名只在表层）。
 *
 * 诚实边界：**裁决**由 evaluate 给出（前端只把布尔前提传进去，不实现裁决逻辑）；
 * **中间值展示**（归心）是前端按 tokens/derived 镜像复算，仅供解释推导链，非 evaluate 输出。
 */
import { useMemo, useState } from 'react';
import { compile, evaluate, canonicalize } from '@aster-cloud/aster-lang-ts/browser';
import { GUYONG } from '@/config/guyong-demo';
import { toCanonical, toDisplay } from '@/lib/layout-map';
import { cn } from '@/components/ui';

/** 编译一次歌词体源码（走 LayoutMap 的 toCanonical=带空格规范源码），memo 避免重复编译。 */
function useCompiledCore() {
  return useMemo(() => {
    const r = compile(toCanonical(GUYONG.layout), { lexicon: GUYONG.lexicon });
    const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
    return { core: r.core, ok: r.success && errs.length === 0, errs };
  }, []);
}

export function GuyongDemoContent() {
  const { core, ok, errs } = useCompiledCore();
  // 每个信物一个布尔，初值全真（「都还在」情形）。
  const [held, setHeld] = useState<Record<string, boolean>>(
    () => Object.fromEntries(GUYONG.tokens.map((tk) => [tk.name, true])),
  );
  const [showCanonical, setShowCanonical] = useState(false);

  // 显示层：LayoutMap 的 toDisplay（无空格流动歌词）；规范版按需展示。
  const displaySource = toDisplay(GUYONG.layout);

  // 引擎实时裁决：把每个前提的拨动布尔直接传给 evaluate（真布尔 decision，无字符串映射），拿真实返回。
  const verdict = useMemo(() => {
    if (!core) return null;
    const inputs: Record<string, boolean> = {};
    for (const tk of GUYONG.tokens) {
      inputs[tk.name] = held[tk.name];
    }
    const ev = evaluate(core, GUYONG.entry, inputs);
    return ev.success ? String(ev.value) : '—';
  }, [core, held]);

  // canonicalize 的引擎实况（表层归一，别名解析成规范关键词）——证明「读的是歌、跑的是规范源码」。
  const canonicalizeOutput = useMemo(() => {
    return canonicalize(toCanonical(GUYONG.layout), {
      lexicon: GUYONG.lexicon,
      locale: GUYONG.lexicon.id,
    });
  }, []);

  // 中间值镜像复算：某信物拨到真 <=> 该 let 绑定为真（前端展示推导链，非 evaluate 输出）。
  const derivedTrue = (from: string[]) => from.every((n) => held[n]);
  const allHeld = GUYONG.tokens.every((tk) => held[tk.name]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">{GUYONG.title}</h1>
        <p className="mt-2 text-sm text-fg-muted">{GUYONG.attribution}</p>
      </header>

      {/* 歌词体源码 / 规范版 */}
      <div className="rounded-lg border border-border bg-bg-subtle p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-fg-muted">
            {showCanonical ? '规范关键词版' : '歌词体源码（原创词，逐字即源码）'}
          </span>
          <button
            type="button"
            onClick={() => setShowCanonical((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {showCanonical ? '看歌词体' : '看规范版'}
          </button>
        </div>
        <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-sm leading-relaxed text-fg">
          {showCanonical ? GUYONG.canonical : displaySource}
        </pre>
      </div>

      {!ok && (
        <p className="mt-3 text-xs text-danger">源码编译失败：{errs.map((e) => e.message).join('; ')}</p>
      )}

      {/* 拨动信物 */}
      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-fg">拨动三个前提，看引擎真推导裁决</h2>
        <p className="mb-4 text-sm text-fg-muted">
          每个前提拨到「在」= 把 true 传给引擎；拨到「失」= 传 false。裁决由引擎当场以 并且 合成、如果/否则 判定。
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {GUYONG.tokens.map((tk) => (
            <button
              key={tk.name}
              type="button"
              role="switch"
              aria-checked={held[tk.name]}
              onClick={() => setHeld((v) => ({ ...v, [tk.name]: !v[tk.name] }))}
              disabled={!core}
              className={cn(
                'flex flex-col gap-1 rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors',
                held[tk.name]
                  ? 'border-accent bg-accent/10 text-fg'
                  : 'border-border bg-bg-subtle text-fg-muted hover:border-accent/50',
                !core && 'cursor-not-allowed opacity-50',
              )}
            >
              <span className="font-display">{tk.label}</span>
              <span className="text-xs text-fg-subtle">
                {held[tk.name] ? '在 · 真' : '失 · 假'}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 引擎推导 + 裁决 */}
      <section className="mt-6 rounded-xl border border-border bg-bg-subtle p-6">
        <p className="mb-4 text-sm font-semibold text-fg">引擎实况：推导 → 裁决</p>

        {/* 中间值（let 绑定镜像） */}
        <p className="mb-2 text-xs font-semibold text-fg-subtle">① 引擎推导的中间值（let 绑定）</p>
        <div className="space-y-1 font-mono text-xs text-fg-muted">
          {GUYONG.derived.map((d) => (
            <p key={d.name}>
              <span className="text-fg">{d.label}</span>
              {' → '}
              <span className={derivedTrue(d.from) ? 'text-accent' : 'text-fg-subtle'}>
                {derivedTrue(d.from) ? '真' : '假'}
              </span>
            </p>
          ))}
        </div>

        {/* 裁决（引擎真返回） */}
        <p className="mt-5 mb-2 text-xs font-semibold text-fg-subtle">② evaluate 入口规则「裁决」的真实返回</p>
        <p className={cn('font-display text-3xl leading-relaxed', allHeld ? 'text-accent' : 'text-fg')}>
          {verdict}
        </p>

        <p className="mt-5 text-sm text-fg-muted">
          三个前提全「在」→ 归心为真 → 裁决「归途」；拨失任一 → 归心为假 → 裁决「坠落」。这是引擎当场以
          并且 合成、如果/否则 判定的结论，不是页面预置的固定文案。
        </p>
      </section>

      {/* canonicalize 实况 */}
      <section className="mt-6 rounded-lg border border-border bg-bg-subtle p-4">
        <p className="mb-2 text-xs font-semibold text-fg-subtle">
          canonicalize 真实输出（引擎产物）——别名 孤身/我问/凭/我说/是否/再问/倘若/答 在表层归一成规范关键词
        </p>
        <pre className="overflow-x-auto rounded-lg border border-border bg-bg p-4 font-mono text-xs leading-relaxed text-fg-muted">
          {canonicalizeOutput}
        </pre>
      </section>

      <footer className="mt-8 rounded-lg border border-border bg-bg-subtle p-4 text-xs leading-relaxed text-fg-muted">
        <p>
          这段源码是<strong className="text-fg">本项目原创的叙事体歌词</strong>（非任何既有歌曲）——
          关键词别名把每句领字变结构关键词，三个前提（守/进/记）是<strong className="text-fg">布尔入参</strong>，
          引擎 令 归心 = 守 <strong className="text-fg">并且</strong> 进 并且 记，再 如果/否则 真判定输出裁决。
          <strong className="text-fg">LayoutMap</strong> 把 <code>作为 布尔</code>/<code>定义为</code>/<code>并且</code> 等语法脚手架隐进标点换行，
          让你读到的是有意境的中文，引擎编译的是带空格规范源码——
          二者逐字对应（<strong className="text-fg">toCanonical(layout) === source</strong>），
          歌词体版与规范关键词版编译出<strong className="text-fg">完全一致的 Core IR</strong>。
          底层与信贷 demo 同一套可证明的执行链。
        </p>
      </footer>
    </div>
  );
}
