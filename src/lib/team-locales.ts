/**
 * @module lib/team-locales
 *
 * 团队级 UI 语言白名单（ADR 0017 Phase 2）。
 *
 * 团队 owner/admin 可设置哪些语言开放给该团队的用户。语言切换器的可用集 =
 * 编译支持（i18n/config 的 locales）∩ 后端可用（/api/v1/lexicons）
 * ∩ 平台允许（系统全局管理员，最高优先级）∩ 此团队白名单。
 *
 * **层级关系**：平台层 > 团队层。团队白名单是平台白名单的**子集**——团队不能
 * 开放平台已禁用的语言。写入时 normalizeEnabledLocales 与平台允许集求交；
 * 读取/解析时也再交一次（防平台事后收紧导致团队留存了已禁语言）。
 *
 * 数据存于 `Team.enabledLocales`（jsonb 数组）。**null = 未配置 = 全部开放**
 * （默认，不破坏既有团队）。空数组不允许——见 normalizeEnabledLocales，
 * 至少保留 defaultLocale，避免把团队锁死在零语言。
 */

import { db, teams, teamMembers } from '@/lib/prisma';
import { eq, inArray } from 'drizzle-orm';
import { locales, defaultLocale, type Locale } from '@/i18n/config';
import { getPlatformEnabledLocales } from '@/lib/platform-settings';

/**
 * 读取团队的语言白名单。
 *
 * @returns locale 数组；`null` 表示未配置（全部开放）。
 */
export async function getTeamEnabledLocales(teamId: string): Promise<Locale[] | null> {
  const row = await db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    columns: { enabledLocales: true },
  });
  const raw = row?.enabledLocales;
  if (!raw || !Array.isArray(raw)) return null;
  // 只保留当前编译支持的 locale，过滤掉陈旧/非法值（防御 schema 漂移）。
  const valid = raw.filter((l): l is Locale => (locales as readonly string[]).includes(l));
  return valid.length > 0 ? valid : null;
}

/**
 * 规范化待写入的白名单：
 *  - 去重 + 仅保留编译支持的 locale
 *  - 始终包含 defaultLocale（默认语言不可被关闭——deferredLocaleNote）
 *  - 若结果等于全集，返回 null（= 未配置 = 全部开放，避免冗余存储）
 *
 * @returns 要写入 DB 的值（locale 数组或 null）
 */
export function normalizeEnabledLocales(input: readonly string[]): Locale[] | null {
  const set = new Set<Locale>();
  set.add(defaultLocale);
  for (const l of input) {
    if ((locales as readonly string[]).includes(l)) set.add(l as Locale);
  }
  // 与全集等价 → 用 null 表达"全部开放"，让默认行为单一来源。
  if (set.size === locales.length) return null;
  // 按 i18n/config 的顺序输出，结果稳定（便于比较 / 测试）。
  return locales.filter((l) => set.has(l));
}

/**
 * 写入团队语言白名单。调用方负责权限校验（TEAM_UPDATE_LOCALES）。
 *
 * @param input 期望开放的 locale 列表；经 normalizeEnabledLocales 处理后落库。
 */
export async function setTeamEnabledLocales(teamId: string, input: readonly string[]): Promise<void> {
  // 团队是平台的子集：先把请求 clamp 到平台允许集（团队不能开平台禁的语言）。
  // platform=null（不限制）则不裁剪。
  const platform = await getPlatformEnabledLocales();
  const clamped = platform ? input.filter((l) => platform.includes(l as Locale)) : input;
  const normalized = normalizeEnabledLocales(clamped);
  await db
    .update(teams)
    .set({ enabledLocales: normalized, updatedAt: new Date() })
    .where(eq(teams.id, teamId));
}

/**
 * 解析某用户的**有效**语言白名单 = 其所属各团队白名单的**并集**。
 *
 * 语义：白名单是"授予"而非"封禁"。用户属于多个团队时，任一团队开放某语言，
 * 该用户即可使用——更严格的团队不应屏蔽另一团队已开放的语言。
 *
 * 返回 `null` 表示"不限制"：用户不属于任何团队，或其所有团队都未配置白名单
 * （即至少一个团队是"全部开放"）——此时不施加团队层限制。
 *
 * @param userId 当前用户 id
 * @returns 并集后的 locale 数组；`null` = 不限制
 */
export async function resolveUserAllowedLocales(userId: string): Promise<Locale[] | null> {
  // Fail-open：此函数在每次 dashboard Server Component 渲染时调用。任何 DB 错误
  // （含迁移滞后导致 Team.enabledLocales 列尚不存在）都必须降级为"不限制"
  // （null），绝不能抛出——否则整个 dashboard 渲染崩溃。语言门是非关键增强，
  // 出错时回退到"全部语言可用"的既有行为是安全且符合最小意外原则的。
  try {
    // 平台层（最高优先级）先取。null = 平台不限制。
    const platform = await getPlatformEnabledLocales();

    const memberships = await db.query.teamMembers.findMany({
      where: eq(teamMembers.userId, userId),
      columns: { teamId: true },
    });

    // 团队层：各团队白名单的并集。任一团队"全部开放"(null)=团队层不限制。
    let team: Locale[] | null = null;
    if (memberships.length > 0) {
      const teamIds = memberships.map((m) => m.teamId);
      const rows = await db.query.teams.findMany({
        where: inArray(teams.id, teamIds),
        columns: { enabledLocales: true },
      });
      const union = new Set<Locale>();
      let anyUnrestricted = false;
      for (const row of rows) {
        const raw = row.enabledLocales;
        if (!raw || !Array.isArray(raw)) { anyUnrestricted = true; break; }
        for (const l of raw) {
          if ((locales as readonly string[]).includes(l)) union.add(l as Locale);
        }
      }
      if (!anyUnrestricted) {
        union.add(defaultLocale);
        team = union.size >= locales.length ? null : locales.filter((l) => union.has(l));
      }
    }

    // 合成：平台 ∩ 团队。任一层 null（不限制）则取另一层；都 null 则整体不限制。
    const effective = intersectAllowlists(platform, team);
    return effective;
  } catch (err) {
    console.error('[team-locales] resolveUserAllowedLocales failed; falling back to unrestricted', err);
    return null;
  }
}

/**
 * 两个白名单求交（null = 不限制）。两层语言门（平台 ∩ 团队）的合成逻辑。
 * - 都 null → null（整体不限制）
 * - 一方 null → 另一方（该层不限制，只受另一层约束）
 * - 都非 null → 交集（保证含 defaultLocale，交集空时兜底 [defaultLocale]）
 */
export function intersectAllowlists(
  a: readonly Locale[] | null,
  b: readonly Locale[] | null,
): Locale[] | null {
  if (!a && !b) return null;
  if (!a) return [...b!];
  if (!b) return [...a];
  const bSet = new Set(b);
  let inter = a.filter((l) => bSet.has(l));
  // 默认语言始终在内；交集空时兜底为 [defaultLocale]，绝不锁死零语言。
  if (!inter.includes(defaultLocale)) inter = [defaultLocale, ...inter];
  // 若交集等于全集，归一成 null（不限制），保持语义单一。
  return inter.length >= locales.length ? null : inter;
}

/**
 * 把团队白名单应用到一组候选 locale 上（纯函数，供 UI / 中间件复用）。
 *
 * @param candidates 候选 locale（通常已是 编译支持 ∩ 后端可用 的交集）
 * @param enabled    团队白名单；null = 不限制
 * @returns 过滤后的可用 locale；保证非空（兜底 defaultLocale）
 */
export function applyTeamLocaleAllowlist(
  candidates: readonly Locale[],
  enabled: readonly Locale[] | null,
): Locale[] {
  if (!enabled) return [...candidates];
  const allow = new Set(enabled);
  const filtered = candidates.filter((l) => allow.has(l));
  // 兜底：交集为空时至少保留 defaultLocale，避免用户被锁在零语言。
  return filtered.length > 0 ? filtered : [defaultLocale];
}
