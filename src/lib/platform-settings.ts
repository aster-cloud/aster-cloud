/*
 * Platform settings — generic admin-controlled key-value flags.
 *
 * Reads are cached per Worker isolate (60s TTL) so a feature gate
 * doesn't translate into a DB hit on every request. The cache is
 * intentionally short — a SaaS admin who flips a kill switch from
 * /admin should see it propagate within a minute, even though
 * individual isolates may serve stale-cached "OFF" for up to 60s.
 *
 * Writes go through setSetting() which invalidates the cache for
 * that key. Cross-isolate invalidation isn't free on Workers
 * (there's no shared in-memory cache); the 60s TTL is the
 * propagation budget.
 *
 * Defaults live alongside the key constants below so every read
 * has a safe fallback when the row is missing (cold cluster, first
 * deploy, accidental DELETE). New features should start OFF so a
 * SaaS admin must explicitly opt in.
 */

import { eq } from 'drizzle-orm';
import { db, platformSettings } from '@/lib/prisma';
import { locales, defaultLocale, type Locale } from '@/i18n/config';

export const PLATFORM_SETTING_KEYS = {
  POLICY_SHARING_ENABLED: 'policy_sharing.enabled',
  // 平台级语言白名单（locale 代号数组，如 ['en','hi']）。null = 未配置 = 全部
  // 编译支持的语言开放。系统全局管理员设定，享最高优先级：团队语言白名单是它的
  // 子集——团队不能开放平台已禁用的语言（见 team-locales 的交集逻辑）。
  ENABLED_LOCALES: 'i18n.enabled_locales',
} as const;

/**
 * Per-key default when the row is missing. Every key in
 * PLATFORM_SETTING_KEYS needs an entry here so reads have a
 * defined fallback.
 */
const DEFAULTS: Record<string, unknown> = {
  [PLATFORM_SETTING_KEYS.POLICY_SHARING_ENABLED]: false,
  // null = 全部开放（不限制）。与 team 层 null 语义一致，避免首部署即锁语言。
  [PLATFORM_SETTING_KEYS.ENABLED_LOCALES]: null,
};

const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  value: unknown;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function fresh(entry: CacheEntry | undefined): entry is CacheEntry {
  return !!entry && entry.expiresAt > Date.now();
}

/**
 * Read a setting. Returns the default when the row is missing or
 * the DB read fails (fail-OFF for feature flags).
 */
export async function getSetting<T = unknown>(key: string): Promise<T> {
  const cached = cache.get(key);
  if (fresh(cached)) return cached.value as T;
  try {
    const row = await db.query.platformSettings.findFirst({
      where: eq(platformSettings.key, key),
    });
    const value = row ? row.value : (DEFAULTS[key] as T);
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value as T;
  } catch (err) {
    console.error('[platform-settings] read failed', key, err);
    // Fail-OFF — flags should never accidentally enable a feature
    // because the DB hiccupped.
    return DEFAULTS[key] as T;
  }
}

/**
 * Write a setting. Invalidates the per-isolate cache for that
 * key on success so subsequent reads on this isolate get fresh
 * data. Other isolates pick up the change within CACHE_TTL_MS.
 *
 * Caller is responsible for permission gating (admin-only).
 * updatedBy is recorded for audit; pass the admin user id.
 */
export async function setSetting(
  key: string,
  value: unknown,
  updatedBy: string,
): Promise<void> {
  const now = new Date();
  // Upsert — pgcrypto-free, uses primary key conflict.
  await db
    .insert(platformSettings)
    .values({
      key,
      value: value as never,
      updatedAt: now,
      updatedBy,
    })
    .onConflictDoUpdate({
      target: platformSettings.key,
      set: {
        value: value as never,
        updatedAt: now,
        updatedBy,
      },
    });
  cache.delete(key);
}

/** Type-safe sugar for the policy-sharing flag. */
export async function isPolicySharingEnabled(): Promise<boolean> {
  const v = await getSetting<boolean>(PLATFORM_SETTING_KEYS.POLICY_SHARING_ENABLED);
  return v === true;
}

/**
 * 平台级语言白名单（系统全局管理员设定）。
 *
 * @returns 已配置的 locale 数组（仅保留编译支持的、且含 defaultLocale）；
 *          `null` 表示未配置 = 全部开放。任何读失败也回退 null（fail-open，
 *          与 getSetting 的 DEFAULTS 一致，绝不因 DB 抖动锁死语言）。
 */
export async function getPlatformEnabledLocales(): Promise<Locale[] | null> {
  const raw = await getSetting<unknown>(PLATFORM_SETTING_KEYS.ENABLED_LOCALES);
  if (!raw || !Array.isArray(raw)) return null;
  const valid = raw.filter((l): l is Locale => (locales as readonly string[]).includes(l));
  if (valid.length === 0) return null;
  const set = new Set<Locale>(valid);
  set.add(defaultLocale); // 默认语言始终开放，不可被平台关闭
  if (set.size >= locales.length) return null; // 等价全集 → 不限制
  return locales.filter((l) => set.has(l));
}

/**
 * 写入平台级语言白名单（admin-only，调用方负责权限）。
 * 规范化：去重 + 仅留编译支持 + 强制含 defaultLocale + 全集折叠成 null。
 */
export async function setPlatformEnabledLocales(
  input: readonly string[],
  updatedBy: string,
): Promise<void> {
  const set = new Set<Locale>();
  set.add(defaultLocale);
  for (const l of input) {
    if ((locales as readonly string[]).includes(l)) set.add(l as Locale);
  }
  const value: Locale[] | null = set.size >= locales.length ? null : locales.filter((l) => set.has(l));
  await setSetting(PLATFORM_SETTING_KEYS.ENABLED_LOCALES, value, updatedBy);
}
