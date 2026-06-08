'use client';

import { useEffect, useRef } from 'react';
import type { editor } from 'monaco-editor';
import { extractRuleSymbols } from '@/lib/aster/rules';

export function useEntryRuleDecorations(
  editorInstance: editor.IStandaloneCodeEditor | null,
  monaco: typeof import('monaco-editor') | null,
  source: string,
  hoverMessage: string,
) {
  const decorationIdsRef = useRef<string[]>([]);

  useEffect(() => {
    if (!editorInstance || !monaco) {
      return;
    }

    const entryRules = extractRuleSymbols(source).filter((rule) => rule.isEntry);
    decorationIdsRef.current = editorInstance.deltaDecorations(
      decorationIdsRef.current,
      entryRules.map((rule) => ({
        range: new monaco.Range(
          rule.range.startLineNumber,
          1,
          rule.range.endLineNumber,
          rule.range.endColumn,
        ),
        options: {
          isWholeLine: true,
          glyphMarginClassName: 'aster-entry-rule-glyph',
          glyphMarginHoverMessage: { value: hoverMessage },
          hoverMessage: { value: hoverMessage },
          linesDecorationsClassName: 'aster-entry-rule-line',
        },
      })),
    );

    return () => {
      decorationIdsRef.current = editorInstance.deltaDecorations(decorationIdsRef.current, []);
    };
  }, [editorInstance, monaco, source, hoverMessage]);
}
