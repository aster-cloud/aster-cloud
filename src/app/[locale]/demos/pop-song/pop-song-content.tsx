'use client';

/**
 * 「流行歌曲即源码」demo(中文彩蛋):周杰伦歌名/歌词即 `.aster` 源码,点「执行」后浏览器内
 * 生产同款 TS 引擎真编译真裁决,决策驱动一幅程序化 SVG 周杰伦简笔画。
 *
 * 交互:三个歌名前提(晴天/青花瓷/双截棍)可拨,点执行 → compile(歌词体源码,周杰伦别名词典)
 * → evaluate(前提值) → 得风格枚举 → 渲染对应简笔画。同时给一键切换看「规范关键词版」,
 * 佐证歌词体 ≡ 规范版(别名只在表层)。
 */
import { useMemo, useState } from 'react';
import { compile, evaluate } from '@aster-cloud/aster-lang-ts/browser';
import { POP_SONG, type SketchStyle } from '@/config/pop-song-demo';
import { JaySketch } from './jay-sketch';
import { cn } from '@/components/ui';

/** 编译一次歌词体源码,拿 Core(memo,避免每次渲染重编译)。 */
function useCompiledCore() {
  return useMemo(() => {
    const r = compile(POP_SONG.source, { lexicon: POP_SONG.lexicon });
    const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
    return { core: r.core, ok: r.success && errs.length === 0, errs };
  }, []);
}

const STYLE_LABEL: Record<SketchStyle, string> = {
  sunny: '《晴天》· 阳光下弹吉他',
  chinese: '《青花瓷》· 执笔的中国风',
  kungfu: '《双截棍》· 双截棍武术姿',
  default: '经典侧影 · 戴帽握麦',
};

export function PopSongDemoContent() {
  const { core, ok, errs } = useCompiledCore();
  const [values, setValues] = useState<Record<string, boolean>>(
    Object.fromEntries(POP_SONG.toggles.map((t) => [t.name, false])),
  );
  const [style, setStyle] = useState<SketchStyle | null>(null);
  const [ran, setRan] = useState(false);
  const [showCanonical, setShowCanonical] = useState(false);

  function run() {
    if (!core) return;
    const ev = evaluate(core, POP_SONG.entry, values);
    // evaluate 返回引擎真裁决的风格字符串;收敛到已知 SketchStyle(兜底 default)。
    const raw = typeof ev.value === 'string' ? ev.value : 'default';
    const s: SketchStyle = (['sunny', 'chinese', 'kungfu', 'default'] as const).includes(raw as SketchStyle)
      ? (raw as SketchStyle)
      : 'default';
    setStyle(s);
    setRan(true);
  }

  function toggle(name: string) {
    setValues((v) => ({ ...v, [name]: !v[name] }));
    // 拨动前提后清空上一幅,提示需重新执行(强调「引擎裁决」而非实时联动)。
    setRan(false);
    setStyle(null);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
          {POP_SONG.title}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">{POP_SONG.attribution}</p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* 左:源码 + 前提 + 执行 */}
        <section className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-bg-subtle p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-fg-muted">
                {showCanonical ? '规范关键词版' : '歌词体源码（歌名即代码）'}
              </span>
              <button
                type="button"
                onClick={() => setShowCanonical((v) => !v)}
                className="text-xs text-accent hover:underline"
              >
                {showCanonical ? '看歌词体' : '看规范版'}
              </button>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-fg">
              {showCanonical ? POP_SONG.canonical : POP_SONG.source}
            </pre>
          </div>

          {!ok && (
            <p className="text-xs text-danger">
              源码编译失败：{errs.map((e) => e.message).join('; ')}
            </p>
          )}

          <div className="rounded-lg border border-border bg-bg-subtle p-4">
            <p className="mb-3 text-xs font-medium text-fg-muted">歌名前提（拨动后点执行，引擎裁决画什么）</p>
            <ul className="flex flex-col gap-2">
              {POP_SONG.toggles.map((tg) => (
                <li key={tg.name}>
                  <button
                    type="button"
                    onClick={() => toggle(tg.name)}
                    className={cn(
                      'flex w-full items-center gap-3 rounded-md border p-2.5 text-left text-sm transition',
                      values[tg.name]
                        ? 'border-accent bg-accent-subtle text-accent-hover'
                        : 'border-border bg-bg text-fg hover:border-accent/40',
                    )}
                  >
                    <span
                      className={cn(
                        'inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]',
                        values[tg.name] ? 'border-accent bg-accent text-white' : 'border-border text-transparent',
                      )}
                    >
                      ✓
                    </span>
                    <span className="min-w-0">{tg.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <button
            type="button"
            onClick={run}
            disabled={!ok}
            className={cn(
              'rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50',
            )}
          >
            执行 · 让引擎裁决画什么
          </button>
        </section>

        {/* 右:简笔画舞台 */}
        <section className="flex flex-col gap-3">
          <div className="flex aspect-square items-center justify-center rounded-lg border border-border bg-bg-subtle p-6">
            <div className="h-full w-full max-w-xs">
              <JaySketch style={style} />
            </div>
          </div>
          <p className="min-h-[1.5rem] text-center text-sm">
            {ran && style ? (
              <span className="text-fg">
                引擎裁决：<span className="font-medium text-accent">{STYLE_LABEL[style]}</span>
              </span>
            ) : (
              <span className="text-fg-muted">拨动歌名前提，点「执行」看引擎画什么</span>
            )}
          </p>
        </section>
      </div>

      <footer className="mt-8 rounded-lg border border-border bg-bg-subtle p-4 text-xs leading-relaxed text-fg-muted">
        <p>
          这段源码用<strong className="text-fg">周杰伦歌名/歌词的领字</strong>当结构关键词（七里香→模块、画面→规则、若→如果、画→返回），
          读起来像歌，却由<strong className="text-fg">生产同款浏览器 TS 引擎逐字真编译、真裁决</strong>——
          歌词体版与规范关键词版编译出<strong className="text-fg">完全一致的 Core IR</strong>（别名只在表层，Lexer/Parser 不知歌名存在）。
          翻动任一前提，引擎裁决即变；这幅简笔画是<strong className="text-fg">决策驱动的程序化 SVG</strong>，非预存图片。
          底层与信贷 demo 同一套可证明的执行链。
        </p>
      </footer>
    </div>
  );
}
