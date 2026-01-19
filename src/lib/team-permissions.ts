import { db, teamMembers } from '@/lib/prisma';
import { eq, and } from 'drizzle-orm';

// 权限定义
export const TeamPermission = {
  TEAM_VIEW: 'team.view',
  TEAM_UPDATE: 'team.update',
  TEAM_DELETE: 'team.delete',
  TEAM_TRANSFER: 'team.transfer',
  MEMBER_VIEW: 'member.view',
  MEMBER_INVITE: 'member.invite',
  MEMBER_REMOVE: 'member.remove',
  MEMBER_UPDATE_ROLE: 'member.updateRole',
  POLICY_VIEW: 'policy.view',
  POLICY_CREATE: 'policy.create',
  POLICY_UPDATE: 'policy.update',
  POLICY_DELETE: 'policy.delete',
  POLICY_EXECUTE: 'policy.execute',
  INVITATION_VIEW: 'invitation.view',
  INVITATION_CREATE: 'invitation.create',
  INVITATION_REVOKE: 'invitation.revoke',
} as const;

export type TeamPermissionType = (typeof TeamPermission)[keyof typeof TeamPermission];

// 角色-权限矩阵
const ROLE_PERMISSIONS: Record<string, TeamPermissionType[]> = {
  owner: Object.values(TeamPermission),
  admin: [
    TeamPermission.TEAM_VIEW,
    TeamPermission.TEAM_UPDATE,
    TeamPermission.MEMBER_VIEW,
    TeamPermission.MEMBER_INVITE,
    TeamPermission.MEMBER_REMOVE,
    TeamPermission.MEMBER_UPDATE_ROLE,
    TeamPermission.POLICY_VIEW,
    TeamPermission.POLICY_CREATE,
    TeamPermission.POLICY_UPDATE,
    TeamPermission.POLICY_DELETE,
    TeamPermission.POLICY_EXECUTE,
    TeamPermission.INVITATION_VIEW,
    TeamPermission.INVITATION_CREATE,
    TeamPermission.INVITATION_REVOKE,
  ],
  member: [
    TeamPermission.TEAM_VIEW,
    TeamPermission.MEMBER_VIEW,
    TeamPermission.POLICY_VIEW,
    TeamPermission.POLICY_CREATE,
    TeamPermission.POLICY_UPDATE,
    TeamPermission.POLICY_EXECUTE,
  ],
  viewer: [TeamPermission.TEAM_VIEW, TeamPermission.MEMBER_VIEW, TeamPermission.POLICY_VIEW],
};

// 角色层级（用于比较）
const ROLE_HIERARCHY = ['viewer', 'member', 'admin', 'owner'] as const;
export type TeamRole = (typeof ROLE_HIERARCHY)[number];

// 结果类型（判别联合模式）
export type TeamAccessResult =
  | { allowed: true; role: TeamRole; teamId: string }
  | { allowed: false; error: string; status: number };

export type PermissionCheckResult =
  | { allowed: true }
  | { allowed: false; error: string; status: number };

// 获取用户在团队中的角色
export async function getTeamMemberRole(userId: string, teamId: string): Promise<TeamRole | null> {
  const membership = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
    columns: { role: true },
  });
  return (membership?.role as TeamRole) ?? null;
}

// 检查用户是否有权访问团队
export async function checkTeamAccess(userId: string, teamId: string): Promise<TeamAccessResult> {
  const role = await getTeamMemberRole(userId, teamId);

  if (!role) {
    return {
      allowed: false,
      error: '你不是此团队的成员',
      status: 403,
    };
  }

  return { allowed: true, role, teamId };
}

// 检查角色是否拥有指定权限
export function hasPermission(role: TeamRole, permission: TeamPermissionType): boolean {
  const permissions = ROLE_PERMISSIONS[role] ?? [];
  return permissions.includes(permission);
}

// 获取角色层级
export function getRoleLevel(role: TeamRole): number {
  return ROLE_HIERARCHY.indexOf(role);
}

// 综合检查：团队访问权限 + 具体权限
export async function checkTeamPermission(
  userId: string,
  teamId: string,
  permission: TeamPermissionType
): Promise<PermissionCheckResult> {
  const access = await checkTeamAccess(userId, teamId);

  if (!access.allowed) {
    return access;
  }

  if (!hasPermission(access.role, permission)) {
    return {
      allowed: false,
      error: `权限不足：${permission} 需要更高的角色`,
      status: 403,
    };
  }

  return { allowed: true };
}

// 验证角色变更（用于成员角色更新）
export function canChangeRole(
  actorRole: TeamRole,
  targetCurrentRole: TeamRole,
  targetNewRole: TeamRole
): PermissionCheckResult {
  // 不能修改 Owner 角色
  if (targetCurrentRole === 'owner') {
    return {
      allowed: false,
      error: '无法修改所有者角色。请使用所有权转让功能。',
      status: 403,
    };
  }

  // 不能提升为 Owner
  if (targetNewRole === 'owner') {
    return {
      allowed: false,
      error: '无法提升为所有者。请使用所有权转让功能。',
      status: 403,
    };
  }

  // Admin 不能修改其他 Admin
  if (actorRole === 'admin' && targetCurrentRole === 'admin') {
    return {
      allowed: false,
      error: '管理员无法修改其他管理员的角色',
      status: 403,
    };
  }

  const actorLevel = getRoleLevel(actorRole);
  const newLevel = getRoleLevel(targetNewRole);

  // 非 Owner 不能分配等于或高于自己的角色
  if (actorRole !== 'owner' && newLevel >= actorLevel) {
    return {
      allowed: false,
      error: '无法分配等于或高于自己的角色',
      status: 403,
    };
  }

  return { allowed: true };
}

// 检查是否可以移除成员
export function canRemoveMember(
  actorRole: TeamRole,
  targetRole: TeamRole,
  isSelf: boolean
): PermissionCheckResult {
  // Owner 不能离开团队
  if (isSelf && targetRole === 'owner') {
    return {
      allowed: false,
      error: '所有者无法离开团队。请先转让所有权。',
      status: 403,
    };
  }

  // 不能移除 Owner
  if (targetRole === 'owner') {
    return {
      allowed: false,
      error: '无法移除团队所有者',
      status: 403,
    };
  }

  // Admin 不能移除其他 Admin
  if (actorRole === 'admin' && targetRole === 'admin' && !isSelf) {
    return {
      allowed: false,
      error: '管理员无法移除其他管理员',
      status: 403,
    };
  }

  return { allowed: true };
}

// 检查邀请角色是否有效
export function canInviteWithRole(
  inviterRole: TeamRole,
  inviteeRole: TeamRole
): PermissionCheckResult {
  // 不能邀请为 Owner
  if (inviteeRole === 'owner') {
    return {
      allowed: false,
      error: '无法邀请用户成为所有者',
      status: 403,
    };
  }

  const inviterLevel = getRoleLevel(inviterRole);
  const inviteeLevel = getRoleLevel(inviteeRole);

  // 非 Owner 不能邀请等于或高于自己角色的人
  if (inviterRole !== 'owner' && inviteeLevel >= inviterLevel) {
    return {
      allowed: false,
      error: '无法邀请用户为等于或高于自己的角色',
      status: 403,
    };
  }

  return { allowed: true };
}
