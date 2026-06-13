'use client';

import { useTranslations } from 'next-intl';

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
}

function TraceStepItem({ step, depth }: { step: TraceStep; depth: number }) {
  const hasChildren = step.children && step.children.length > 0;

  const row = (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="shrink-0 text-xs text-fg-subtle tabular-nums w-5 text-right">
          {step.sequence}
        </span>
        <code className="text-xs text-fg dark:text-gray-200 truncate">
          {step.expression}
        </code>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {step.result !== undefined && step.result !== null && (
          <span className="text-xs text-fg-muted dark:text-fg-subtle max-w-[120px] truncate">
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
    return <div className={depth > 0 ? 'pl-4 border-l border-border dark:border-gray-700' : ''}>{row}</div>;
  }

  return (
    <details className={depth > 0 ? 'pl-4 border-l border-border dark:border-gray-700' : ''}>
      <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
        <div className="flex items-center gap-1">
          <svg className="h-3 w-3 text-fg-subtle transition-transform [[open]>&]:rotate-90" viewBox="0 0 12 12" fill="currentColor">
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

export function DecisionTracePanel({ trace }: DecisionTracePanelProps) {
  const t = useTranslations('decisionTrace');

  return (
    <section
      aria-label={t('ariaLabel')}
      className="rounded-xl border border-border bg-bg-subtle p-4 dark:border-gray-700 dark:bg-gray-800"
    >
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-fg dark:text-gray-100">{t('title')}</h3>
        <span className="text-xs text-fg-muted dark:text-fg-subtle">
          {trace.moduleName}.{trace.functionName} — {trace.executionTimeMs}ms
        </span>
      </div>
      {trace.steps.length > 0 ? (
        <div className="space-y-0.5">
          {trace.steps.map((step, i) => (
            <TraceStepItem key={`${step.sequence}-${i}`} step={step} depth={0} />
          ))}
        </div>
      ) : (
        <div className="py-6 text-center text-sm text-fg-muted dark:text-fg-subtle">
          {t('empty')}
        </div>
      )}
      <div className="mt-3 pt-3 border-t border-border dark:border-gray-700 flex items-center justify-between text-xs">
        <span className="text-fg-muted dark:text-fg-subtle">Result</span>
        <span className="font-medium text-fg dark:text-gray-100">
          {trace.finalResult !== null && trace.finalResult !== undefined
            ? typeof trace.finalResult === 'object'
              ? JSON.stringify(trace.finalResult)
              : String(trace.finalResult)
            : '—'}
        </span>
      </div>
    </section>
  );
}
