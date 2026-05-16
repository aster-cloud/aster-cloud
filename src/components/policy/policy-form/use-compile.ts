'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Debounced "compile on type" hook.
 *
 * The editor calls this with the current source body and CNL locale;
 * the hook waits for the user to pause typing (default 600 ms), POSTs
 * to /api/policies/compile, and exposes the result as state. An in-
 * flight request is cancelled (via AbortController) the moment fresh
 * input arrives so stale responses can't clobber newer ones.
 *
 * State surface:
 *   - `state`: 'idle' | 'pending' | 'ok' | 'error'
 *       - idle    nothing to compile (empty source) or first mount
 *       - pending request in flight (UI shows a spinner / "checking")
 *       - ok      compile succeeded, diagnostics may still be present
 *       - error   transport-level failure (5xx, network); diagnostics
 *                 here are not authoritative
 *   - `diagnostics`: structured ranges from the upstream compiler
 *   - `module`: the parsed module summary on success
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
  /** Server-level failure message (network / 5xx), distinct from
   *  compiler diagnostics which are routine. */
  transportError?: string;
}

interface UseCompileOptions {
  source: string;
  locale: string;
  /** Debounce window in ms. */
  debounceMs?: number;
  /** Pass false to disable while the form is mounting / unmounting. */
  enabled?: boolean;
}

export function useCompile({
  source,
  locale,
  debounceMs = 600,
  enabled = true,
}: UseCompileOptions): UseCompileResult {
  const [state, setState] = useState<CompileState>('idle');
  const [diagnostics, setDiagnostics] = useState<CompileDiagnostic[]>([]);
  const [moduleInfo, setModuleInfo] = useState<CompileModuleSummary | undefined>();
  const [transportError, setTransportError] = useState<string | undefined>();

  // Track the in-flight request so a follow-on keystroke can cancel it.
  const inflightRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (source.trim().length === 0) {
      setState('idle');
      setDiagnostics([]);
      setModuleInfo(undefined);
      setTransportError(undefined);
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (inflightRef.current) inflightRef.current.abort();
      const ctrl = new AbortController();
      inflightRef.current = ctrl;
      setState('pending');

      fetch('/api/policies/compile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, locale }),
        signal: ctrl.signal,
      })
        .then(async (res) => {
          // Even on 4xx the body may carry diagnostics, so we parse
          // regardless of res.ok and rely on the payload's `success`.
          const data = (await res.json().catch(() => null)) as
            | {
                success?: boolean;
                error?: string;
                diagnostics?: CompileDiagnostic[];
                module?: CompileModuleSummary;
              }
            | null;
          if (!data) {
            setState('error');
            setTransportError(`HTTP ${res.status}`);
            return;
          }
          if (!res.ok && !data.diagnostics) {
            setState('error');
            setTransportError(data.error || `HTTP ${res.status}`);
            return;
          }
          setDiagnostics(data.diagnostics ?? []);
          setModuleInfo(data.module);
          setTransportError(undefined);
          setState('ok');
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            // Superseded by a newer request — leave state as 'pending'
            // so the next response paints.
            return;
          }
          setState('error');
          setTransportError(
            err instanceof Error ? err.message : 'Network error',
          );
        });
    }, debounceMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [source, locale, debounceMs, enabled]);

  // Final cleanup: cancel anything in flight on unmount.
  useEffect(() => {
    return () => {
      if (inflightRef.current) inflightRef.current.abort();
    };
  }, []);

  return { state, diagnostics, module: moduleInfo, transportError };
}
