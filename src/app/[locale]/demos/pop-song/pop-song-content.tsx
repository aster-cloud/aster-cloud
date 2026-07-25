'use client';

/**
 * 「流行歌曲即源码」demo(中文彩蛋)——《以父之名》真实歌词逐字即 `.aster` 源码。
 *
 * 范式=源码即歌 + 字面量宏(同静夜思):点「运行」后浏览器内生产同款 TS 引擎真编译真求值,
 * 别名把歌词领字变结构关键词、字面量宏把末词「自负」展开成整句主题句,入口规则输出该句。
 * 一键切「看规范版」佐证歌词体 ≡ 规范版(别名/宏只在表层)。
 */
import { useMemo, useState } from 'react';
import {
  compile,
  evaluate,
  vocabularyRegistry,
  initBuiltinVocabularies,
} from '@aster-cloud/aster-lang-ts/browser';
import { POP_SONG } from '@/config/pop-song-demo';
import { cn } from '@/components/ui';

/** 编译一次歌词体源码(先注册字面量宏词汇,再带 domain 编译),memo 避免重复编译。 */
function useCompiledCore() {
  return useMemo(() => {
    initBuiltinVocabularies();
    vocabularyRegistry.registerCustom(POP_SONG.vocab.id, POP_SONG.vocab);
    const r = compile(POP_SONG.source, {
      lexicon: POP_SONG.lexicon,
      domain: POP_SONG.vocab.id,
      tenantId: POP_SONG.vocab.id,
    });
    const errs = (r as { parseErrors?: { message?: string }[] }).parseErrors ?? [];
    return { core: r.core, ok: r.success && errs.length === 0, errs };
  }, []);
}

export function PopSongDemoContent() {
  const { core, ok, errs } = useCompiledCore();
  const [output, setOutput] = useState<string | null>(null);
  const [showCanonical, setShowCanonical] = useState(false);

  function run() {
    if (!core) return;
    const ev = evaluate(core, POP_SONG.entry, {});
    setOutput(typeof ev.value === 'string' ? ev.value : String(ev.value));
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
          {POP_SONG.title}
        </h1>
        <p className="mt-2 text-sm text-fg-muted">{POP_SONG.attribution}</p>
      </header>

      {/* 歌词体源码 / 规范版 */}
      <div className="rounded-lg border border-border bg-bg-subtle p-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-fg-muted">
            {showCanonical ? '规范关键词版' : '歌词体源码（真实歌词，逐字未改）'}
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
          {showCanonical ? POP_SONG.canonical : POP_SONG.source}
        </pre>
      </div>

      {!ok && (
        <p className="mt-3 text-xs text-danger">
          源码编译失败：{errs.map((e) => e.message).join('; ')}
        </p>
      )}

      <button
        type="button"
        onClick={run}
        disabled={!ok}
        className={cn(
          'mt-5 w-full rounded-md bg-accent px-4 py-2.5 text-sm font-medium text-white transition hover:bg-accent-hover disabled:opacity-50',
        )}
      >
        运行 · 以父之名
      </button>

      {/* 运行输出 */}
      <div className="mt-6 flex min-h-[6rem] items-center justify-center rounded-lg border border-border bg-bg-subtle p-6 text-center">
        {output !== null ? (
          <p className="font-display text-xl leading-relaxed text-fg">{output}</p>
        ) : (
          <p className="text-sm text-fg-muted">点「运行」，让引擎逐字执行这段歌词</p>
        )}
      </div>

      <footer className="mt-8 rounded-lg border border-border bg-bg-subtle p-4 text-xs leading-relaxed text-fg-muted">
        <p>
          这段源码是《以父之名》<strong className="text-fg">真实歌词，逐字未改</strong>——
          关键词别名把每句领字变结构关键词（仁慈的父→模块、看不见→规则、请原谅我→产出、我低头→返回），
          <strong className="text-fg">字面量宏</strong>把末词「
          <span className="font-mono text-fg">{POP_SONG.macroTrigger}</span>
          」展开成整句主题句。歌词读起来是歌，却由<strong className="text-fg">生产同款浏览器 TS 引擎逐字真编译、真求值</strong>——
          歌词体版与规范关键词版编译出<strong className="text-fg">完全一致的 Core IR</strong>
          （别名与宏只在表层，Lexer/Parser 不知歌词存在）。运行入口规则，引擎输出这句歌词。
          底层与信贷 demo 同一套可证明的执行链。
        </p>
      </footer>
    </div>
  );
}
