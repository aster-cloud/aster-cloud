/**
 * 计算用户在 dashboard 导航上下文中的"有效角色"。
 *
 * 单飞用户（没加入任何 team）→ 视同 owner（自己拥有所有个人数据）。
 * 多 team 成员 → 取所有 team 中**最高**的 role：
 *   viewer < member < admin < owner
 *
 * 用于 layout.tsx 过滤 nav 项 —— viewer 不应在 nav 看到他点了之后
 * 满屏 disabled 按钮的 page；member 不应看到只有 owner 能操作的 billing。
 *
 * 真实操作授权仍由 API 层 checkTeamPermission 兜底，这里只决定**入口可见性**。
 */
import { db } from '@/lib/prisma';
import { teamMembers } from '@/db/schema';
import { eq } from 'drizzle-orm';

export type EffectiveRole = 'viewer' | 'member' | 'admin' | 'owner';

const ROLE_RANK: Record<EffectiveRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

export async function getEffectiveRole(userId: string): Promise<EffectiveRole> {
  const memberships = await db.query.teamMembers.findMany({
    where: eq(teamMembers.userId, userId),
    columns: { role: true },
  });

  if (memberships.length === 0) {
    // 没加入任何 team：自己的个人 dashboard 全部可见
    return 'owner';
  }

  let best: EffectiveRole = 'viewer';
  for (const m of memberships) {
    const r = m.role as EffectiveRole;
    if (ROLE_RANK[r] > ROLE_RANK[best]) best = r;
  }
  return best;
}

export function canAccess(role: EffectiveRole, minimum: EffectiveRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}
