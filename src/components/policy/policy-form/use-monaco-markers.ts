'use client';

import { useEffect } from 'react';
import type { editor } from 'monaco-editor';
import type { CompileDiagnostic } from './use-compile';

/**
 * Project compile diagnostics onto the Monaco editor as inline markers.
 *
 * Monaco surfaces markers as the squiggly underlines + the side-bar
 * gutter glyphs + the "Problems" tooltip on hover, so the user sees
 * exactly where the error is without leaving the editor.
 *
 * We tag our markers with `owner: 'aster-cnl'` so we can clear ONLY
 * our own markers and not stomp on any others Monaco might attach
 * (e.g. JSON validation or future plug-ins).
 */

const MARKER_OWNER = 'aster-cnl';

/** Maps our diagnostic severity onto Monaco's `MarkerSeverity`. */
function toMonacoSeverity(
  monaco: typeof import('monaco-editor'),
  severity: CompileDiagnostic['severity'],
): number {
  switch (severity) {
    case 'error':
      return monaco.MarkerSeverity.Error;
    case 'warning':
      return monaco.MarkerSeverity.Warning;
    case 'info':
      return monaco.MarkerSeverity.Info;
    case 'hint':
      return monaco.MarkerSeverity.Hint;
  }
}

export function useMonacoMarkers(
  editor: editor.IStandaloneCodeEditor | null,
  diagnostics: CompileDiagnostic[],
): void {
  useEffect(() => {
    if (!editor) return;
    // Late-bind monaco from window so we don't pull the heavy package
    // into this client hook's bundle. The editor instance always has
    // a parent model; monaco itself is loaded as a side-effect of
    // MonacoPolicyEditor.
    const monaco = (globalThis as { monaco?: typeof import('monaco-editor') })
      .monaco;
    if (!monaco) return;
    const model = editor.getModel();
    if (!model) return;

    const markers = diagnostics.map((d) => ({
      severity: toMonacoSeverity(monaco, d.severity),
      message: d.message,
      startLineNumber: d.startLine,
      startColumn: d.startColumn,
      endLineNumber: d.endLine,
      endColumn: d.endColumn,
      code: d.code,
    }));

    monaco.editor.setModelMarkers(model, MARKER_OWNER, markers);

    return () => {
      // Clear ONLY our own markers on cleanup. Setting `[]` for the
      // same owner is the Monaco idiom for "I have no current findings."
      const monacoNow = (globalThis as {
        monaco?: typeof import('monaco-editor');
      }).monaco;
      const modelNow = editor.getModel();
      if (monacoNow && modelNow) {
        monacoNow.editor.setModelMarkers(modelNow, MARKER_OWNER, []);
      }
    };
  }, [editor, diagnostics]);
}
