/**
 * API 速率限制服务
 *
 * 使用滑动窗口算法进行速率限制，防止 API 滥用。
 * 默认使用内存存储，生产环境建议替换为 Redis。
 */

interface RateLimitConfig {
  /** 时间窗口（毫秒） */
  windowMs: number;
  /** 窗口内最大请求数 */
  maxRequests: number;
}

interface RateLimitEntry {
  /** 请求时间戳列表 */
  timestamps: number[];
  /** 锁定截止时间 */
  lockedUntil?: number;
}

// 内存存储（生产环境应使用 Redis）
const rateLimitStore = new Map<string, RateLimitEntry>();

// 定期清理过期条目
const CLEANUP_INTERVAL_MS = 60 * 1000; // 1分钟
let cleanupTimer: NodeJS.Timeout | null = null;

function startCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitStore.entries()) {
      // 清理已解锁且无有效时间戳的条目
      if (entry.timestamps.length === 0 && (!entry.lockedUntil || entry.lockedUntil < now)) {
        rateLimitStore.delete(key);
      }
    }
  }, CLEANUP_INTERVAL_MS);
}

// 启动清理定时器
if (typeof window === 'undefined') {
  startCleanup();
}

/**
 * 预定义的速率限制配置
 */
export const RateLimitPresets = {
  /** 登录端点：每分钟5次 */
  LOGIN: { windowMs: 60 * 1000, maxRequests: 5 },
  /** 注册端点：每小时10次 */
  SIGNUP: { windowMs: 60 * 60 * 1000, maxRequests: 10 },
  /** 密码重置：每小时3次 */
  PASSWORD_RESET: { windowMs: 60 * 60 * 1000, maxRequests: 3 },
  /** API 调用：每分钟60次 */
  API: { windowMs: 60 * 1000, maxRequests: 60 },
  /** API 调用（宽松）：每分钟120次 */
  API_RELAXED: { windowMs: 60 * 1000, maxRequests: 120 },
  /** 策略执行：每分钟30次 */
  POLICY_EXECUTE: { windowMs: 60 * 1000, maxRequests: 30 },
} as const;

export interface RateLimitResult {
  /** 是否允许请求 */
  allowed: boolean;
  /** 剩余请求数 */
  remaining: number;
  /** 窗口重置时间（Unix时间戳，毫秒） */
  resetAt: number;
  /** 如果被限制，需要等待的秒数 */
  retryAfterSeconds?: number;
  /** 是否被锁定（超出限制被暂时禁止） */
  locked?: boolean;
}

/**
 * 检查并记录请求，返回速率限制结果
 *
 * @param identifier 请求标识符（如 IP 地址、用户 ID）
 * @param config 速率限制配置
 * @returns 速率限制检查结果
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig = RateLimitPresets.API
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = rateLimitStore.get(identifier);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(identifier, entry);
  }

  // 检查是否被锁定
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const retryAfterSeconds = Math.ceil((entry.lockedUntil - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.lockedUntil,
      retryAfterSeconds,
      locked: true,
    };
  }

  // 清理过期的时间戳
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  // 检查是否超出限制
  if (entry.timestamps.length >= config.maxRequests) {
    const oldestTimestamp = entry.timestamps[0];
    const resetAt = oldestTimestamp + config.windowMs;
    const retryAfterSeconds = Math.ceil((resetAt - now) / 1000);

    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds,
    };
  }

  // 记录当前请求
  entry.timestamps.push(now);

  const remaining = config.maxRequests - entry.timestamps.length;
  const resetAt = entry.timestamps[0] + config.windowMs;

  return {
    allowed: true,
    remaining,
    resetAt,
  };
}

/**
 * 锁定标识符一段时间
 *
 * @param identifier 请求标识符
 * @param lockDurationMs 锁定时长（毫秒）
 */
export function lockIdentifier(identifier: string, lockDurationMs: number): void {
  let entry = rateLimitStore.get(identifier);

  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(identifier, entry);
  }

  entry.lockedUntil = Date.now() + lockDurationMs;
}

/**
 * 解锁标识符
 *
 * @param identifier 请求标识符
 */
export function unlockIdentifier(identifier: string): void {
  const entry = rateLimitStore.get(identifier);
  if (entry) {
    entry.lockedUntil = undefined;
  }
}

/**
 * 重置标识符的速率限制计数
 *
 * @param identifier 请求标识符
 */
export function resetRateLimit(identifier: string): void {
  rateLimitStore.delete(identifier);
}

/**
 * 获取客户端 IP 地址
 */
export function getClientIp(request: Request): string {
  // Cloudflare
  const cfConnectingIp = request.headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp;

  // X-Forwarded-For（取第一个）
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const ips = xForwardedFor.split(',').map((ip) => ip.trim());
    return ips[0];
  }

  // X-Real-IP
  const xRealIp = request.headers.get('x-real-ip');
  if (xRealIp) return xRealIp;

  // 回退到未知
  return 'unknown';
}

/**
 * 生成速率限制响应头
 */
export function getRateLimitHeaders(result: RateLimitResult, config: RateLimitConfig): HeadersInit {
  return {
    'X-RateLimit-Limit': config.maxRequests.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': Math.ceil(result.resetAt / 1000).toString(),
    ...(result.retryAfterSeconds ? { 'Retry-After': result.retryAfterSeconds.toString() } : {}),
  };
}
