'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useAIAssistant } from '@/hooks/useAIAssistant';
import type { editor } from 'monaco-editor';

interface AIAssistantPanelProps {
  editor: editor.IStandaloneCodeEditor | null;
  locale: string;
  tenantId?: string;
  onApply: (source: string) => void;
  onClose: () => void;
}

export function AIAssistantPanel({
  editor: monacoEditor,
  locale,
  tenantId,
  onApply,
  onClose,
}: AIAssistantPanelProps) {
  const t = useTranslations('ai');
  const [prompt, setPrompt] = useState('');
  const [showDiff, setShowDiff] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const {
    streaming,
    content,
    error,
    validationError,
    completed,
    generate,
    cancel,
    reset,
  } = useAIAssistant();

  // 聚焦输入框
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;

    const existingSource = monacoEditor?.getValue() || undefined;
    await generate(
      {
        goal: prompt.trim(),
        locale,
        existingSource: existingSource || undefined,
      },
      tenantId,
    );
    setShowDiff(true);
  }, [prompt, monacoEditor, locale, tenantId, generate]);

  const handleApply = useCallback(() => {
    if (!content) return;

    if (monacoEditor) {
      // 作为单个 edit operation，支持 Ctrl+Z 撤销
      const model = monacoEditor.getModel();
      if (model) {
        monacoEditor.executeEdits('ai-assistant', [
          {
            range: model.getFullModelRange(),
            text: content,
          },
        ]);
      }
    }
    onApply(content);
    setShowDiff(false);
    reset();
  }, [content, monacoEditor, onApply, reset]);

  const handleRetry = useCallback(() => {
    reset();
    setShowDiff(false);
    handleGenerate();
  }, [reset, handleGenerate]);

  const handleReject = useCallback(() => {
    reset();
    setShowDiff(false);
  }, [reset]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        handleGenerate();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleGenerate, onClose],
  );

  return (
    <aside
      className="flex flex-col border border-gray-200 dark:border-gray-700 rounded-xl bg-white dark:bg-gray-800 shadow-lg overflow-hidden"
      role="complementary"
      aria-label={t('panelTitle')}
    >
      {/* 头部 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {t('panelTitle')}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-md text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
          aria-label={t('close')}
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* 输入区域 */}
      <div className="px-4 pt-3 pb-2">
        <textarea
          ref={textareaRef}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('promptPlaceholder')}
          rows={3}
          disabled={streaming}
          className="w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 focus:outline-none resize-none disabled:opacity-50"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-gray-400">
            {t('shortcutHint')}
          </span>
          <div className="flex gap-2">
            {streaming ? (
              <button
                type="button"
                onClick={cancel}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
              >
                <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 16 16">
                  <rect x="3" y="3" width="10" height="10" rx="1" />
                </svg>
                {t('stop')}
              </button>
            ) : (
              <button
                type="button"
                onClick={handleGenerate}
                disabled={!prompt.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                {t('generate')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 流式输出区域 */}
      {(streaming || content) && (
        <div className="flex-1 px-4 pb-3 overflow-auto">
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3">
            {/* 状态指示 */}
            {streaming && (
              <div className="flex items-center gap-2 mb-2 text-xs text-indigo-600 dark:text-indigo-400">
                <div className="flex gap-0.5">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:0ms]" />
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:150ms]" />
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-500 animate-bounce [animation-delay:300ms]" />
                </div>
                {t('generating')}
              </div>
            )}

            {/* 代码预览 */}
            <pre className="text-xs font-mono text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words max-h-64 overflow-auto">
              {content}
              {streaming && <span className="inline-block w-1.5 h-4 bg-indigo-500 animate-pulse ml-0.5" />}
            </pre>
          </div>

          {/* 校验状态 */}
          {validationError && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 p-2 text-xs text-amber-700 dark:text-amber-300">
              <svg className="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
              </svg>
              <span>{t('validationFailed')}: {validationError}</span>
            </div>
          )}

          {completed && !error && !validationError && (
            <div className="mt-2 flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 p-2 text-xs text-green-700 dark:text-green-300">
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{t('validationPassed')}</span>
            </div>
          )}

          {/* 错误 */}
          {error && (
            <div className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 p-2 text-xs text-red-700 dark:text-red-300">
              <svg className="h-4 w-4 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* 操作按钮 */}
          {completed && content && !streaming && (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={handleApply}
                className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                {t('apply')}
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" />
                </svg>
                {t('retry')}
              </button>
              <button
                type="button"
                onClick={handleReject}
                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
                {t('reject')}
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
