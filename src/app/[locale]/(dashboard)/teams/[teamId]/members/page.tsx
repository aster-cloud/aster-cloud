'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { formatDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface Member {
  id: string;
  userId: string;
  role: string;
  user: {
    id: string;
    name: string | null;
    email: string;
  };
  joinedAt: string;
}

interface Invitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

interface Team {
  id: string;
  name: string;
  slug: string;
}

type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

// Branded confirm state — replaces three window.confirm() call sites
// (revoke invitation / remove member / leave team) with a single
// ConfirmDialog instance. The discriminated union keeps the dialog
// stateless across action types and avoids three parallel pendingId
// booleans.
type PendingAction =
  | { kind: 'revokeInvitation'; invitationId: string }
  | { kind: 'removeMember'; memberId: string; memberName: string }
  | { kind: 'leaveTeam'; memberId: string };

export default function TeamMembersPage() {
  const t = useTranslations('teams');
  const tCommon = useTranslations('common');
  const params = useParams();
  const router = useRouter();
  const teamId = params.teamId as string;
  const locale = params.locale as string;

  const [team, setTeam] = useState<Team | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [userRole, setUserRole] = useState<string>('');
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [hasMoreMembers, setHasMoreMembers] = useState(false);
  const [totalMembers, setTotalMembers] = useState(0);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  // 邀请表单状态
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<TeamRole>('member');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');

  // ConfirmDialog state — see PendingAction discriminated union above.
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [isActioning, setIsActioning] = useState(false);

  useEffect(() => {
    fetchData();
  }, [teamId]);

  const fetchData = async () => {
    try {
      const [teamRes, membersRes, invitationsRes] = await Promise.all([
        fetch(`/api/teams/${teamId}`),
        fetch(`/api/teams/${teamId}/members?limit=100`),
        fetch(`/api/teams/${teamId}/invitations`),
      ]);

      // 检查团队请求
      if (!teamRes.ok) {
        const data = await teamRes.json();
        throw new Error(data.error || 'Failed to fetch team');
      }

      const teamData = await teamRes.json();
      setTeam(teamData.team);
      setUserRole(teamData.role);

      // 检查成员列表请求
      if (!membersRes.ok) {
        const data = await membersRes.json();
        throw new Error(data.error || t('members.loadFailed'));
      }
      const membersData = await membersRes.json();
      setMembers(membersData.members);
      setCurrentUserId(membersData.currentUserId);
      // 处理分页信息
      if (membersData.pagination) {
        setHasMoreMembers(membersData.pagination.hasMore);
        setTotalMembers(membersData.pagination.total);
      }

      // 检查邀请列表请求
      if (!invitationsRes.ok) {
        const data = await invitationsRes.json();
        throw new Error(data.error || t('members.invitationsLoadFailed'));
      }
      const invitationsData = await invitationsRes.json();
      setInvitations(invitationsData.invitations);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('failedToLoad'));
    } finally {
      setIsLoading(false);
    }
  };

  // 加载更多成员
  const loadMoreMembers = async () => {
    if (isLoadingMore || !hasMoreMembers) return;
    setIsLoadingMore(true);
    try {
      const res = await fetch(`/api/teams/${teamId}/members?limit=100&offset=${members.length}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || t('members.loadFailed'));
      }
      const data = await res.json();
      setMembers((prev) => [...prev, ...data.members]);
      if (data.pagination) {
        setHasMoreMembers(data.pagination.hasMore);
        setTotalMembers(data.pagination.total);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('members.loadFailed'));
    } finally {
      setIsLoadingMore(false);
    }
  };

  const canInvite = userRole === 'owner' || userRole === 'admin';
  const canRemove = userRole === 'owner' || userRole === 'admin';
  const canChangeRole = userRole === 'owner' || userRole === 'admin';

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsInviting(true);
    setInviteError('');

    try {
      const res = await fetch(`/api/teams/${teamId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to send invitation');
      }

      setInvitations((prev) => [...prev, data]);
      setShowInviteForm(false);
      setInviteEmail('');
      setInviteRole('member');
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : t('members.inviteFailed'));
    } finally {
      setIsInviting(false);
    }
  };

  const handleRevokeInvitation = (invitationId: string) => {
    setPendingAction({ kind: 'revokeInvitation', invitationId });
  };

  const handleRemoveMember = (memberId: string, memberName: string) => {
    setPendingAction({ kind: 'removeMember', memberId, memberName });
  };

  const handleRoleChange = async (memberId: string, newRole: TeamRole) => {
    try {
      const res = await fetch(`/api/teams/${teamId}/members/${memberId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to update role');
      }

      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: newRole } : m))
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('members.updateFailed'));
    }
  };

  const handleLeaveTeam = (memberId: string) => {
    setPendingAction({ kind: 'leaveTeam', memberId });
  };

  // Single executor for all three pending actions — invoked by the
  // shared ConfirmDialog after the user confirms.
  const runPendingAction = async () => {
    if (!pendingAction) return;
    setIsActioning(true);
    try {
      if (pendingAction.kind === 'revokeInvitation') {
        const res = await fetch(
          `/api/teams/${teamId}/invitations/${pendingAction.invitationId}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || t('members.revokeFailed'));
        }
        setInvitations((prev) =>
          prev.filter((i) => i.id !== pendingAction.invitationId),
        );
      } else if (pendingAction.kind === 'removeMember') {
        const res = await fetch(
          `/api/teams/${teamId}/members/${pendingAction.memberId}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to remove member');
        }
        setMembers((prev) => prev.filter((m) => m.id !== pendingAction.memberId));
        setTotalMembers((prev) => Math.max(0, prev - 1));
        setHasMoreMembers(
          (prev) => prev && members.length - 1 < totalMembers - 1,
        );
      } else if (pendingAction.kind === 'leaveTeam') {
        const res = await fetch(
          `/api/teams/${teamId}/members/${pendingAction.memberId}`,
          { method: 'DELETE' },
        );
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to leave team');
        }
        router.push(`/${locale}/teams`);
        return; // skip clearing — navigation away kills this component
      }
      setPendingAction(null);
    } catch (err) {
      const fallback =
        pendingAction.kind === 'revokeInvitation'
          ? t('members.revokeFailed')
          : pendingAction.kind === 'removeMember'
            ? t('members.removeFailed')
            : t('members.leaveFailed');
      setError(err instanceof Error ? err.message : fallback);
      setPendingAction(null);
    } finally {
      setIsActioning(false);
    }
  };

  // Derive dialog title/description from the current pending action,
  // reusing the already-translated message keys for each row's CTA.
  const pendingDialogProps = pendingAction
    ? pendingAction.kind === 'revokeInvitation'
      ? {
          title: t('members.revoke'),
          confirmLabel: t('members.revoke'),
          description: t('members.confirmRevokeInvitation'),
        }
      : pendingAction.kind === 'removeMember'
        ? {
            title: t('members.remove'),
            confirmLabel: t('members.remove'),
            description: t('members.confirmRemove', { name: pendingAction.memberName }),
          }
        : {
            title: t('members.leave'),
            confirmLabel: t('members.leave'),
            description: t('members.confirmLeave'),
          }
    : { title: '', confirmLabel: '', description: '' };

  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner':
        return 'bg-accent-subtle text-accent-hover';
      case 'admin':
        return 'bg-blue-100 text-blue-800';
      case 'member':
        return 'bg-green-100 text-green-800';
      case 'viewer':
        return 'bg-gray-100 text-gray-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getAvailableRoles = (): TeamRole[] => {
    if (userRole === 'owner') {
      return ['admin', 'member', 'viewer'];
    }
    if (userRole === 'admin') {
      return ['member', 'viewer'];
    }
    return [];
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!team) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{error || t('teamNotFound')}</p>
        <Link href={`/${locale}/teams`} className="mt-4 text-primary hover:text-primary-hover">
          {t('backToTeams')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      {/* 页头 */}
      <div className="mb-6">
        <Link
          href={`/${locale}/teams/${teamId}`}
          className="inline-flex items-center text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {t('backToTeam')}
        </Link>
      </div>

      <div className="sm:flex sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('members.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{team.name}</p>
        </div>
        {canInvite && (
          <div className="mt-4 sm:mt-0">
            <button
              onClick={() => setShowInviteForm(true)}
              className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover"
            >
              <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              {t('members.inviteMember')}
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-4 rounded-md bg-red-50 p-4">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* 邀请表单模态框 */}
      {showInviteForm && (
        <div className="fixed inset-0 bg-gray-500 bg-opacity-75 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">{t('members.inviteTitle')}</h3>
            </div>
            <form onSubmit={handleInvite} className="px-6 py-4 space-y-4">
              {inviteError && (
                <div className="rounded-md bg-red-50 p-3">
                  <p className="text-sm text-red-700">{inviteError}</p>
                </div>
              )}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                  {t('members.emailLabel')}
                </label>
                <input
                  type="email"
                  id="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                  placeholder={t('members.emailPlaceholder')}
                />
              </div>
              <div>
                <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                  {t('members.roleLabel')}
                </label>
                <select
                  id="role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                  className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary focus:ring-primary sm:text-sm"
                >
                  {getAvailableRoles().map((role) => (
                    <option key={role} value={role}>
                      {t(`roles.${role}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowInviteForm(false)}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  {t('cancel')}
                </button>
                <button
                  type="submit"
                  disabled={isInviting}
                  className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-hover disabled:opacity-50"
                >
                  {isInviting ? t('members.sending') : t('members.sendInvite')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 待处理邀请 */}
      {invitations.length > 0 && canInvite && (
        <div className="mt-8">
          <h2 className="text-lg font-medium text-gray-900">{t('members.pendingInvitations')}</h2>
          <div className="mt-4 bg-white shadow rounded-lg overflow-hidden">
            <ul className="divide-y divide-gray-200">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{invitation.email}</p>
                    <p className="text-xs text-gray-500">
                      {t('members.expiresAt', {
                        date: formatDate(invitation.expiresAt, locale),
                      })}
                    </p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRoleBadgeColor(invitation.role)}`}>
                      {t(`roles.${invitation.role}`)}
                    </span>
                    <button
                      onClick={() => handleRevokeInvitation(invitation.id)}
                      className="text-red-600 hover:text-red-800 text-sm"
                    >
                      {t('members.revoke')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 成员列表 */}
      <div className="mt-8">
        <h2 className="text-lg font-medium text-gray-900">
          {t('members.currentMembers', { count: totalMembers || members.length })}
        </h2>
        {hasMoreMembers && (
          <p className="text-sm text-gray-500 mt-1">
            {t('members.showingPartial', { shown: members.length, total: totalMembers })}
          </p>
        )}
        <div className="mt-4 bg-white shadow rounded-lg overflow-hidden">
          <ul className="divide-y divide-gray-200">
            {members.map((member) => (
              <li key={member.id} className="px-4 py-4 sm:px-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div className="w-10 h-10 rounded-full bg-primary-subtle flex items-center justify-center">
                      <span className="text-primary font-medium">
                        {(member.user.name || member.user.email).charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-900">
                        {member.user.name || member.user.email}
                      </p>
                      {member.user.name && (
                        <p className="text-xs text-gray-500">{member.user.email}</p>
                      )}
                      <p className="text-xs text-gray-400">
                        {t('members.joinedAt', {
                          date: formatDate(member.joinedAt, locale),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    {member.role === 'owner' ? (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRoleBadgeColor(member.role)}`}>
                        {t(`roles.${member.role}`)}
                      </span>
                    ) : canChangeRole && (userRole === 'owner' || (userRole === 'admin' && member.role !== 'admin')) ? (
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value as TeamRole)}
                        className="rounded-md border-gray-300 text-sm focus:border-primary focus:ring-primary"
                      >
                        {getAvailableRoles().map((role) => (
                          <option key={role} value={role}>{t(`roles.${role}`)}</option>
                        ))}
                      </select>
                    ) : (
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getRoleBadgeColor(member.role)}`}>
                        {t(`roles.${member.role}`)}
                      </span>
                    )}
                    {member.userId === currentUserId && member.role !== 'owner' ? (
                      <button
                        onClick={() => handleLeaveTeam(member.id)}
                        className="text-orange-600 hover:text-orange-800 text-sm"
                      >
                        {t('members.leave')}
                      </button>
                    ) : canRemove && member.role !== 'owner' && member.userId !== currentUserId && (
                      <button
                        onClick={() => handleRemoveMember(member.id, member.user.name || member.user.email)}
                        className="text-red-600 hover:text-red-800 text-sm"
                      >
                        {t('members.remove')}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {/* 加载更多按钮 */}
          {hasMoreMembers && (
            <div className="px-4 py-3 bg-gray-50 border-t border-gray-200">
              <button
                onClick={loadMoreMembers}
                disabled={isLoadingMore}
                className="w-full text-center text-sm text-primary hover:text-primary-hover disabled:text-gray-400"
              >
                {isLoadingMore ? t('members.loadingMore') : t('members.loadMore')}
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={pendingAction !== null}
        title={pendingDialogProps.title}
        description={pendingDialogProps.description}
        confirmLabel={pendingDialogProps.confirmLabel}
        cancelLabel={tCommon('cancel')}
        variant="danger"
        isLoading={isActioning}
        onConfirm={runPendingAction}
        onCancel={() => !isActioning && setPendingAction(null)}
      />
    </div>
  );
}
