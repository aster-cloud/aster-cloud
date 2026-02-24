'use client';

interface ErrorStateProps {
  /** 错误对象或错误消息字符串 */
  error: Error | string;
  /** 重试回调；不传则不显示重试按钮 */
  onRetry?: () => void;
  /** 额外的 CSS class */
  className?: string;
}

/**
 * 可复用的错误状态组件。
 *
 * 使用 role="alert" + aria-live="assertive" 确保屏幕阅读器立即播报错误信息。
 * 支持浅色 / 深色模式。
 */
export function ErrorState({ error, onRetry, className = '' }: ErrorStateProps) {
  const message = error instanceof Error ? error.message : error;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`rounded-md bg-red-50 dark:bg-gray-800 p-4 ${className}`}
    >
      <div className="flex items-start">
        {/* 错误图标 */}
        <svg
          className="h-5 w-5 text-red-400 dark:text-red-300 flex-shrink-0 mt-0.5"
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
        >
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
            clipRule="evenodd"
          />
        </svg>

        <div className="ml-3 flex-1">
          <p className="text-sm text-red-700 dark:text-white">{message}</p>

          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 text-sm font-medium text-red-700 dark:text-red-300 underline hover:text-red-900 dark:hover:text-white focus:outline-none focus:ring-2 focus:ring-red-500 rounded"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
