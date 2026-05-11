// Per-API-key per-second token bucket rate limit
//
// 默认配额（按 plan）：
//   Free        : 0 RPS（不开放 API，由 ApiQuotaGuard 拦截）
//   Trial       : 10 RPS
//   Pro         : 10 RPS
//   Team        : 50 RPS
//   Enterprise  : 200 RPS
//
// 实现：固定窗口（1 秒），Redis INCR + EXPIRE
//   - 简单胜过 Lua token bucket：边缘场景 1 秒边界稍宽松，PM 视角可接受
//   - Redis 不可达 → fail-open（业务 SLA > 限流精度）
//
// Key 形态：rl:api:<apiKeyId>:<unix-second>

import { getRedis } from '@/lib/redis';
import type { PlanType } from '@/lib/plans';

export const PLAN_RPS: Record<PlanType, number> = {
  free: 0,
  trial: 10,
  pro: 10,
  team: 50,
  enterprise: 200,
};

export interface RateCheckResult {
  allowed: boolean;
  /** 该 key 当前秒已消耗 */
  used: number;
  /** 限额 RPS */
  limit: number;
  /** 重试建议秒数（仅 allowed=false 时有意义） */
  retryAfterSec?: number;
}

/**
 * 检查并消耗一个 token；fail-open
 *
 * @param apiKeyId 调用方 API key 标识（来自 X-Api-Key-Id 头）
 * @param plan     调用方所在用户/团队的 plan
 */
export async function checkRate(apiKeyId: string, plan: PlanType): Promise<RateCheckResult> {
  const limit = PLAN_RPS[plan] ?? 10;
  if (limit <= 0) {
    return { allowed: false, used: 0, limit: 0, retryAfterSec: 1 };
  }

  const redis = getRedis();
  if (!redis) {
    // fail-open：Redis 不可达不阻塞业务
    return { allowed: true, used: 0, limit };
  }

  const second = Math.floor(Date.now() / 1000);
  const key = `rl:api:${apiKeyId}:${second}`;
  try {
    // Pipeline: INCR + EXPIRE 1s
    const pipe = redis.multi();
    pipe.incr(key);
    pipe.expire(key, 2); // 留 1s 余量防边界丢失
    const results = await pipe.exec();
    const used = (results?.[0]?.[1] as number) ?? 0;

    if (used > limit) {
      return { allowed: false, used, limit, retryAfterSec: 1 };
    }
    return { allowed: true, used, limit };
  } catch {
    // Redis 异常 → fail-open
    return { allowed: true, used: 0, limit };
  }
}
