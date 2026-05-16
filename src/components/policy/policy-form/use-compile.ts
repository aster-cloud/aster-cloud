'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  validateSyntaxWithSpan,
  EN_US,
  ZH_CN,
  DE_DE,
  type Lexicon,
} from '@aster-cloud/aster-lang-ts/browser';

/**
 * Real-time CNL compile-on-type using the in-browser parser.
 *
 * We deliberately do NOT round-trip to a backend `/compile` endpoint
 * here: the upstream Java service exposes `/validate` (which takes a
 * deployed module+function id, not source) but no source-level
 * compile route — every fetch was returning 502. The browser-bundled
 * @aster-cloud/aster-lang-ts ships `validateSyntaxWithSpan(source,
 * lexicon)` for exactly this case: lexer + parser, no type check, no
 * file-system access. Net result is faster (zero network), works
 * offline, and the diagnostics carry real line/column spans we can
 * project onto Monaco markers.
 *
 * State surface (unchanged from the original network-backed shape so
 * StatusBar / SidePanel keep working):
 *   - idle    → no source yet
 *   - pending → debounce window in progress (briefly visible during
 *               keystroke storms; transitions to ok very quickly
 *               since parsing is local + synchronous)
 *   - ok      → validation ran; diagnostics may still be present
 *   - error   → unrecoverable internal error (would be surprising;
 *               kept for parity with the previous fetch error path)
 */

export interface CompileDiagnostic {
  severity: 'error' | 'warning' | 'info' | 'hint';
  message: string;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  code?: string;
}

export interface CompileModuleSummary {
  name: string;
  functions: string[];
  types: string[];
}

export type CompileState = 'idle' | 'pending' | 'ok' | 'error';

export interface UseCompileResult {
  state: CompileState;
  diagnostics: CompileDiagnostic[];
  module?: CompileModuleSummary;
  /** Kept on the result type so consumers don't need to change; the
   *  browser parser path never sets this. */
  transportError?: string;
}

interface UseCompileOptions {
  source: string;
  /** CNL locale: 'en' | 'zh' | 'de' — selects the matching lexicon. */
  locale: string;
  /** Debounce window in ms. Default 250 — parsing is local so we can
   *  afford a much tighter feedback loop than network-backed compile. */
  debounceMs?: number;
  enabled?: boolean;
}

/** Map our locale strings to the lexicon constants. */
function lexiconFor(locale: string): Lexicon {
  if (locale.startsWith('zh')) return ZH_CN;
  if (locale.startsWith('de')) return DE_DE;
  return EN_US;
}

export function useCompile({
  source,
  locale,
  debounceMs = 250,
  enabled = true,
}: UseCompileOptions): UseCompileResult {
  const [state, setState] = useState<CompileState>('idle');
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>([]);

  const lexicon = useMemo(() => lexiconFor(locale), [locale]);

  useEffect(() => {
    if (!enabled) return;
    if (source.trim().length === 0) {
      setState('idle');
      setDiagnostics([]);
      return;
    }

    setState('pending');
    const handle = setTimeout(() => {
      try {
        const errors = validateSyntaxWithSpan(source, lexicon);
        const mapped: CompileDiagnostic[] = errors.map((e) => ({
          // validateSyntaxWithSpan only surfaces errors. We could
          // upgrade to compile() later for warnings, but for the
          // real-time loop "error vs nothing" is the right signal.
          severity: 'error',
          message: e.message,
          // The parser is 1-based for lines, 0-based for columns;
          // Monaco wants 1-based for both. Clamp to >= 1.
          startLine: e.span?.start.line ?? 1,
          startColumn: Math.max(1, (e.span?.start.col ?? 0) + 1),
          endLine: e.span?.end.line ?? e.span?.start.line ?? 1,
          endColumn: Math.max(
            1,
            (e.span?.end.col ?? e.span?.start.col ?? 0) + 1,
          ),
        }));
        setDiagnostics(mapped);
        setState('ok');
      } catch (err) {
        // The browser parser should never throw on user input — it
        // returns diagnostics for parse failures — but if it does
        // (e.g. corrupt lexicon), we don't want a runtime crash.
        // Log and treat as transient.
        console.warn('[useCompile] parser crashed:', err);
        setDiagnostics([]);
        setState('error');
      }
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [source, lexicon, debounceMs, enabled]);

  // No module summary from validateSyntaxWithSpan (it's parse-only,
  // doesn't surface the Module name back). Leave undefined; consumers
  // already render a friendly fallback.
  return { state, diagnostics };
}
