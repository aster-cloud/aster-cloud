'use client';

import { useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { DiffEditor } from '@monaco-editor/react';
import { useTheme } from 'next-themes';

interface AIDiffPreviewProps {
  original: string;
  generated: string;
  onAccept: () => void;
  onReject: () => void;
}

export function AIDiffPreview({ original, generated, onAccept, onReject }: AIDiffPreviewProps) {
  const t = useTranslations('ai');
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const handleAccept = useCallback(() => {
    onAccept();
  }, [onAccept]);

  const handleReject = useCallback(() => {
    onReject();
  }, [onReject]);

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
          {t('diffPreview')}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleAccept}
            className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
            {t('acceptDiff')}
          </button>
          <button
            type="button"
            onClick={handleReject}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
            {t('rejectDiff')}
          </button>
        </div>
      </div>
      <DiffEditor
        height="300px"
        language="aster-cnl"
        original={original}
        modified={generated}
        theme={isDark ? 'vs-dark' : 'vs'}
        options={{
          readOnly: true,
          renderSideBySide: true,
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderOverviewRuler: false,
        }}
      />
    </div>
  );
}
