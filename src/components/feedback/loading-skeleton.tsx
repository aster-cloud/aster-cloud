'use client';

interface LoadingSkeletonProps {
  /** 骨架屏行数，默认 3 行 */
  lines?: number;
  /** 额外的 CSS class */
  className?: string;
}

/**
 * 可复用的骨架屏加载组件。
 *
 * 使用 aria-live="polite" + role="status" 确保屏幕阅读器能感知加载状态，
 * 不打断正在进行的朗读。
 */
export function LoadingSkeleton({ lines = 3, className = '' }: LoadingSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading..."
      aria-live="polite"
      className={`animate-pulse ${className}`}
    >
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className={`h-4 bg-gray-200 dark:bg-gray-700 rounded mb-3 ${
            // 最后一行缩短，呈现自然的文本轮廓
            index === lines - 1 ? 'w-3/4' : 'w-full'
          }`}
        />
      ))}
      {/* 对纯视觉用户隐藏，但为屏幕阅读器提供文字说明 */}
      <span className="sr-only">Loading...</span>
    </div>
  );
}
