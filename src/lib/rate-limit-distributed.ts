/**
 * 分布式速率限制（审计 #168）——KV 支撑的全局计数，修复内存 Map 的 per-isolate 缺陷。
 *
 * 背景：{@link ./rate-limit} 的 checkRateLimit 用进程内 Map，在 Cloudflare Workers 上**每个
 * isolate 各一份**——攻击者把请求分散到多个 isolate 即可绕过（login 爆破 / reset 邮件轰炸 /
 * 用户枚举，正是审计点名的风险）。本模块把计数存到共享 KV（binding=CACHE），使同一 identifier
 * 的窗口计数在所有 isolate 间共享，得到近似全局的限流。
 *
 * **一致性权衡（诚实标注）**：KV 是最终一致 + read-modify-write 非原子。极端并发下多个 isolate
 * 可能同时读到 N-1 各自 +1 写回 → 短暂略微超过 maxRequests。对"防爆破/轰炸"够用（数量级正确），
 * 但不是硬上限。若需精确原子上限，应上 Durable Object（更重：新 DO 类 + wrangler migration +
 * OpenNext DO 支持）——审计明确列 KV 为可接受方案，故先用 KV 收敛主要风险。
 *
 * **优雅降级**：非 Cloudflare 环境（本地 dev / on-prem / 测试）KV 不可用 → 回退到同步内存
 * {@link checkRateLimit}（单进程内正确，与既有行为一致）。故对这些环境零行为变化。
 *
 * 用固定窗口计数器（非滑动窗口时间戳数组）——KV 只存一个整数 + TTL，读写最省，且 fixed-window
 * 对限流目的足够。key 形如 `rl:<identifier>:<windowStart>`，随窗口滚动自然过期。
 */

import { createHash } from 'node:crypto';
import {
  checkRateLimit,
  type RateLimitConfig,
  type RateLimitResult,
  RateLimitPresets,
} from './rate-limit';

// 与 cache.ts 同款最小 KVNamespace 声明（不依赖 @cloudflare/workers-types 全局，保持
// 该 lib 的模块边界干净）。只声明本模块用到的 get/put。
interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
}

interface KvEnv {
  CACHE?: KVNamespace;
}

/** 取 Cloudflare KV（binding=CACHE）；非 Cloudflare 环境返回 null。与 cache.ts 同模式。 */
async function getKV(): Promise<KVNamespace | null> {
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare');
    const context = await getCloudflareContext({ async: true });
    return (context.env as KvEnv)?.CACHE ?? null;
  } catch {
    return null;
  }
}

const KEY_PREFIX = 'rl:';

/**
 * 把 identifier 哈希进 KV key，避免 PII（如 IP+email）明文进 KV key，也规避 KV key 长度限制。
 * 哈希只用于 key 命名，不影响限流语义（同 identifier → 同 key）。
 */
function hashIdentifier(identifier: string): string {
  return createHash('sha256').update(identifier).digest('hex').slice(0, 32);
}

/**
 * 分布式速率检查。KV 可用时用共享固定窗口计数器；否则回退同步内存限流器。
 *
 * @param identifier  限流键（如 `login:<ip>:<email>`）
 * @param config      窗口 + 上限
 * @param now         当前时间（可注入以便测试；默认 Date.now()）
 */
export async function checkRateLimitDistributed(
  identifier: string,
  config: RateLimitConfig = RateLimitPresets.API,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const kv = await getKV();
  if (!kv) {
    // 降级：单进程内内存限流（dev/on-prem/test），行为与既有一致。
    return checkRateLimit(identifier, config);
  }

  // 固定窗口：窗口起点对齐到 windowMs 边界，key 随窗口滚动，靠 TTL 自动过期。
  // key 用哈希后的 identifier（避免 PII 入 KV key + 规避 key 长度限制）。
  const windowStart = Math.floor(now / config.windowMs) * config.windowMs;
  const resetAt = windowStart + config.windowMs;
  const key = `${KEY_PREFIX}${hashIdentifier(identifier)}:${windowStart}`;

  try {
    const raw = await kv.get(key);
    const count = raw ? parseInt(raw, 10) || 0 : 0;

    if (count >= config.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt,
        retryAfterSeconds: Math.ceil((resetAt - now) / 1000),
      };
    }

    // 递增并写回。read-modify-write 非原子（见文件头一致性权衡），但对限流目的可接受。
    // TTL 设为窗口剩余时间（+1s 容差），窗口结束后 key 自动消失。
    // ★写在 try 内：若 put 抛错（KV 可读不可写=配额/权限/服务异常），整个 catch 会回退到
    // 内存限流，而不是"放行且不计数"（审计 #168 Codex 复审 High：写失败不得 fail-open to nothing）。
    const ttlSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000) + 1);
    await kv.put(key, String(count + 1), { expirationTtl: ttlSeconds });

    return {
      allowed: true,
      remaining: config.maxRequests - (count + 1),
      resetAt,
    };
  } catch {
    // 任何 KV 失败（读或写）→ 回退内存限流（fail-open to memory，仍有 per-isolate 兜底），
    // 而非无限流。限流基础设施抖动不该大面积拒合法用户，但也不能给"打挂 KV 即无限流"的口子。
    return checkRateLimit(identifier, config);
  }
}
