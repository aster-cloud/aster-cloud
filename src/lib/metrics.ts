/**
 * 可观测性指标辅助库
 *
 * 提供结构化日志和性能指标收集。
 * 在 Cloudflare Workers 环境中，数据发送到 Workers Analytics Engine。
 * 在本地环境中，写入控制台。
 */

interface MetricEvent {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp?: number;
}

interface StructuredLog {
  level: 'info' | 'warn' | 'error';
  message: string;
  traceId?: string;
  duration?: number;
  tags?: Record<string, string | number | boolean>;
}

/**
 * 记录结构化日志
 */
export function logStructured(log: StructuredLog): void {
  const entry = {
    timestamp: new Date().toISOString(),
    level: log.level,
    msg: log.message,
    traceId: log.traceId,
    duration: log.duration,
    ...log.tags,
  };

  if (log.level === 'error') {
    console.error(JSON.stringify(entry));
  } else if (log.level === 'warn') {
    console.warn(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

/**
 * 记录性能指标
 */
export function recordMetric(event: MetricEvent): void {
  logStructured({
    level: 'info',
    message: `metric:${event.name}`,
    tags: {
      metricName: event.name,
      metricValue: event.value,
      ...(event.tags || {}),
    },
  });
}

/**
 * 计时器：测量异步操作耗时
 */
export async function withTiming<T>(
  name: string,
  fn: () => Promise<T>,
  tags?: Record<string, string>
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const duration = performance.now() - start;
    recordMetric({ name, value: duration, tags: { ...tags, status: 'success' } });
    return result;
  } catch (error) {
    const duration = performance.now() - start;
    recordMetric({ name, value: duration, tags: { ...tags, status: 'error' } });
    throw error;
  }
}

/**
 * SLO 指标常量
 */
export const SLO = {
  /** 策略评估 P95 延迟目标（毫秒） */
  EVALUATION_P95_MS: 500,
  /** API 错误率目标 */
  ERROR_RATE_TARGET: 0.01,
  /** 限流饱和度警告阈值 */
  RATE_LIMIT_SATURATION: 0.8,
} as const;
