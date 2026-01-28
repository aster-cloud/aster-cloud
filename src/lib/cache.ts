/**
 * Cloudflare KV 缓存服务
 *
 * 提供统一的缓存接口，用于：
 * - 策略内容缓存（减少数据库读取）
 * - 用户会话缓存（加速认证）
 * - API 响应缓存（减少后端调用）
 */

// KV 命名空间类型（Cloudflare Workers 环境）
interface KVNamespace {
  get(key: string, options?: { type?: 'text' | 'json' | 'arrayBuffer' | 'stream' }): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number; metadata?: unknown }): Promise<void>;
  delete(key: string): Promise<void>;
}

// 全局 KV 绑定（由 Cloudflare Workers 运行时注入）
declare global {
  // eslint-disable-next-line no-var
  var CACHE: KVNamespace | undefined;
}

// 缓存键前缀
const CACHE_PREFIX = {
  POLICY: 'policy:',
  POLICY_CONTENT: 'policy-content:',
  USER: 'user:',
  SESSION: 'session:',
} as const;

// 默认 TTL（秒）
const DEFAULT_TTL = {
  POLICY: 300,        // 5 分钟
  POLICY_CONTENT: 600, // 10 分钟
  USER: 300,          // 5 分钟
  SESSION: 3600,      // 1 小时
} as const;

/**
 * 获取 KV 命名空间
 * 在非 Cloudflare 环境返回 null
 */
function getKV(): KVNamespace | null {
  if (typeof globalThis !== 'undefined' && globalThis.CACHE) {
    return globalThis.CACHE;
  }
  return null;
}

/**
 * 缓存策略内容
 */
export async function cachePolicyContent(
  policyId: string,
  content: string,
  ttl: number = DEFAULT_TTL.POLICY_CONTENT
): Promise<void> {
  const kv = getKV();
  if (!kv) return;

  try {
    await kv.put(`${CACHE_PREFIX.POLICY_CONTENT}${policyId}`, content, {
      expirationTtl: ttl,
    });
  } catch (error) {
    console.warn('[Cache] Failed to cache policy content:', error);
  }
}

/**
 * 获取缓存的策略内容
 */
export async function getCachedPolicyContent(policyId: string): Promise<string | null> {
  const kv = getKV();
  if (!kv) return null;

  try {
    return await kv.get(`${CACHE_PREFIX.POLICY_CONTENT}${policyId}`);
  } catch (error) {
    console.warn('[Cache] Failed to get cached policy content:', error);
    return null;
  }
}

/**
 * 缓存策略元数据（id, name, userId, teamId, isPublic）
 */
export interface CachedPolicyMeta {
  id: string;
  name: string;
  userId: string;
  teamId: string | null;
  isPublic: boolean;
  content: string;
}

export async function cachePolicyMeta(
  policyId: string,
  meta: CachedPolicyMeta,
  ttl: number = DEFAULT_TTL.POLICY
): Promise<void> {
  const kv = getKV();
  if (!kv) return;

  try {
    await kv.put(`${CACHE_PREFIX.POLICY}${policyId}`, JSON.stringify(meta), {
      expirationTtl: ttl,
    });
  } catch (error) {
    console.warn('[Cache] Failed to cache policy meta:', error);
  }
}

/**
 * 获取缓存的策略元数据
 */
export async function getCachedPolicyMeta(policyId: string): Promise<CachedPolicyMeta | null> {
  const kv = getKV();
  if (!kv) return null;

  try {
    const data = await kv.get(`${CACHE_PREFIX.POLICY}${policyId}`);
    if (!data) return null;
    return JSON.parse(data) as CachedPolicyMeta;
  } catch (error) {
    console.warn('[Cache] Failed to get cached policy meta:', error);
    return null;
  }
}

/**
 * 失效策略缓存（更新或删除策略时调用）
 */
export async function invalidatePolicyCache(policyId: string): Promise<void> {
  const kv = getKV();
  if (!kv) return;

  try {
    await Promise.all([
      kv.delete(`${CACHE_PREFIX.POLICY}${policyId}`),
      kv.delete(`${CACHE_PREFIX.POLICY_CONTENT}${policyId}`),
    ]);
  } catch (error) {
    console.warn('[Cache] Failed to invalidate policy cache:', error);
  }
}

/**
 * 缓存用户数据（plan, trialEndsAt）
 */
export interface CachedUserData {
  plan: string;
  trialEndsAt: string | null;
}

export async function cacheUserData(
  userId: string,
  data: CachedUserData,
  ttl: number = DEFAULT_TTL.USER
): Promise<void> {
  const kv = getKV();
  if (!kv) return;

  try {
    await kv.put(`${CACHE_PREFIX.USER}${userId}`, JSON.stringify(data), {
      expirationTtl: ttl,
    });
  } catch (error) {
    console.warn('[Cache] Failed to cache user data:', error);
  }
}

/**
 * 获取缓存的用户数据
 */
export async function getCachedUserData(userId: string): Promise<CachedUserData | null> {
  const kv = getKV();
  if (!kv) return null;

  try {
    const data = await kv.get(`${CACHE_PREFIX.USER}${userId}`);
    if (!data) return null;
    return JSON.parse(data) as CachedUserData;
  } catch (error) {
    console.warn('[Cache] Failed to get cached user data:', error);
    return null;
  }
}

/**
 * 失效用户缓存
 */
export async function invalidateUserCache(userId: string): Promise<void> {
  const kv = getKV();
  if (!kv) return;

  try {
    await kv.delete(`${CACHE_PREFIX.USER}${userId}`);
  } catch (error) {
    console.warn('[Cache] Failed to invalidate user cache:', error);
  }
}

/**
 * 通用缓存函数 - 带回退的缓存读取
 * 如果缓存命中，返回缓存数据
 * 如果缓存未命中，调用 fetcher 获取数据并缓存
 */
export async function withCache<T>(
  key: string,
  fetcher: () => Promise<T>,
  ttl: number = 300
): Promise<T> {
  const kv = getKV();

  // 如果没有 KV，直接调用 fetcher
  if (!kv) {
    return fetcher();
  }

  try {
    // 尝试从缓存读取
    const cached = await kv.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch (error) {
    console.warn('[Cache] Failed to read cache:', error);
  }

  // 缓存未命中，调用 fetcher
  const data = await fetcher();

  // 异步写入缓存（不阻塞响应）
  try {
    kv.put(key, JSON.stringify(data), { expirationTtl: ttl }).catch((err) =>
      console.warn('[Cache] Failed to write cache:', err)
    );
  } catch (error) {
    console.warn('[Cache] Failed to initiate cache write:', error);
  }

  return data;
}
