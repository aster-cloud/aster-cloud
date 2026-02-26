'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useAIAssistant } from '@/hooks/useAIAssistant';

export interface TraceStep {
  sequence: number;
  expression: string;
  result: unknown;
  matched: boolean;
  children?: TraceStep[];
}

export interface DecisionTrace {
  moduleName: string;
  functionName: string;
  steps: TraceStep[];
  finalResult: unknown;
  executionTimeMs: number;
}

interface DecisionTracePanelProps {
  trace: DecisionTrace;
  /** 策略源码（传入后显示 AI 解释按钮） */
  source?: string;
  locale?: string;
  tenantId?: string;
}

function TraceStepItem({ step, depth }: { step: TraceStep; depth: number }) {
  const hasChildren = step.children && step.children.length > 0;

  const row = (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-xs text-gray-400 tabular-nums w-5 text-right">
          {step.sequence}
        </span>
        <code className="text-xs text-gray-800 dark:text-gray-200 truncate">
          {step.expression}
        </code>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {step.result !== undefined && step.result !== null && (
          <span className="text-xs text-gray-500 dark:text-gray-400 max-w-[120px] truncate">
            {String(step.result)}
          </span>
        )}
        <span
          className={`inline-flex h-2 w-2 rounded-full ${
            step.matched
              ? 'bg-green-500'
              : 'bg-gray-300 dark:bg-gray-600'
          }`}
          aria-label={step.matched ? 'matched' : 'not matched'}
        />
      </div>
    </div>
  );

  if (!hasChildren) {
    return <div className={depth > 0 ? 'pl-4 border-l border-gray-200 dark:border-gray-700' : ''}>{row}</div>;
  }

  return (
    <details className={depth > 0 ? 'pl-4 border-l border-gray-200 dark:border-gray-700' : ''}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-1">
          <svg className="h-3 w-3 text-gray-400 transition-transform [[open]>&]:rotate-90" viewBox="0 0 12 12" fill="currentColor">
            <path d="M4.5 2l5 4-5 4V2z" />
          </svg>
          <div className="flex-1">{row}</div>
        </div>
      </summary>
      <div className="mt-1 space-y-0.5">
        {step.children!.map((child, i) => (
          <TraceStepItem key={`${child.sequence}-${i}`} step={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

export function DecisionTracePanel({ trace, source, locale, tenantId }: DecisionTracePanelProps) {
  const t = useTranslations('decisionTrace');
  const tAI = useTranslations('ai');
  const [showExplanation, setShowExplanation] = useState(false);
  const ai = useAIAssistant();

  const handleExplain = async () => {
    if (!source) return;
    setShowExplanation(true);
    await ai.explain(
      {
        source,
        locale: locale || 'en-US',
        traceData: trace,
      },
      tenantId,
    );
  };

  return (
    <section
      aria-label={t('ariaLabel')}
      className="rounded-xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t('title')}</h3>
        <div className="flex items-center gap-3">
          {source && (
            <button
              type="button"
              onClick={handleExplain}
              disabled={ai.streaming}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500 disabled:opacity-50"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              {tAI('explain')}
            </button>
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400">
            {trace.moduleName}.{trace.functionName} — {trace.executionTimeMs}ms
          </span>
        </div>
      </div>
      {trace.steps.length > 0 ? (
        <div className="space-y-0.5">
          {trace.steps.map((step, i) => (
            <TraceStepItem key={`${step.sequence}-${i}`} step={step} depth={0} />
          ))}
        </div>
      ) : (
        <div className="py-6 text-center text-sm text-gray-500 dark:text-gray-400">
          {t('empty')}
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between text-xs">
        <span className="text-gray-500 dark:text-gray-400">Result</span>
        <span className="font-medium text-gray-900 dark:text-gray-100">{String(trace.finalResult)}</span>
      </div>

      {/* AI 解释区域 */}
      {showExplanation && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">{tAI('explain')}</span>
            <button
              type="button"
              onClick={() => { setShowExplanation(false); ai.reset(); }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              {tAI('close')}
            </button>
          </div>
          {ai.streaming && (
            <div className="flex items-center gap-2 mb-1 text-xs text-indigo-600 dark:text-indigo-400">
              <div className="flex gap-0.5">
                <span className="inline-block h-1 w-1 rounded-full bg-indigo-500 animate-bounce [animation-delay:0ms]" />
                <span className="inline-block h-1 w-1 rounded-full bg-indigo-500 animate-bounce [animation-delay:150ms]" />
                <span className="inline-block h-1 w-1 rounded-full bg-indigo-500 animate-bounce [animation-delay:300ms]" />
              </div>
            </div>
          )}
          <div className="text-xs text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
            {ai.content}
            {ai.streaming && <span className="inline-block w-1 h-3 bg-indigo-500 animate-pulse ml-0.5" />}
          </div>
          {ai.error && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">{ai.error}</p>
          )}
        </div>
      )}
    </section>
  );
}
