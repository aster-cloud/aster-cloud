'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Badge,
  Card,
  CardBody,
  Label,
  Select,
  Stack,
  buttonVariants,
  cn,
} from '@/components/ui';

/*
 * "Share with team" card on /policies/:id.
 *
 * Self-gates: calls GET /api/policies/:id/shares on mount. A 404
 * means either (a) the platform admin disabled the
 * policy_sharing.enabled flag, or (b) the current user is not the
 * policy owner. In either case the card renders nothing — we don't
 * leak the existence of the feature to non-owners or when admins
 * have turned it off.
 *
 * Adding a share: pick a team from the dropdown (caller's own
 * teams), POST /shares. Removing: DELETE ?teamId=…
 *
 * Permission bundle is fixed at view+execute on the API side; this
 * UI does not expose a permission selector (intentional — see
 * api/policies/[id]/shares/route.ts top-of-file comment).
 */

type SharePermission = 'view' | 'execute';

interface Share {
  id: string;
  teamId: string;
  teamName: string;
  teamSlug: string;
  permission: SharePermission;
  sharedByUserId: string;
  createdAt: string;
}

interface MyTeam {
  id: string;
  name: string;
  slug: string;
  role: string;
}

export function ShareWithTeamsCard({ policyId }: { policyId: string }) {
  const t = useTranslations('policies.share');
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [myTeams, setMyTeams] = useState<MyTeam[]>([]);
  const [selected, setSelected] = useState<string>('');
  const [permission, setPermission] = useState<SharePermission>('execute');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadShares = useCallback(async () => {
    try {
      const res = await fetch(`/api/policies/${policyId}/shares`);
      if (res.status === 404) {
        // Feature disabled by admin, or caller isn't the owner.
        setEnabled(false);
        return;
      }
      if (!res.ok) {
        setEnabled(false);
        return;
      }
      const data = (await res.json()) as { shares: Share[] };
      setEnabled(true);
      setShares(data.shares);
    } catch {
      setEnabled(false);
    }
  }, [policyId]);

  useEffect(() => {
    loadShares();
  }, [loadShares]);

  // Load caller's teams once enabled — only needed to populate the
  // "share with" dropdown. Hidden when feature is off so we don't
  // pay the request.
  useEffect(() => {
    if (enabled !== true) return;
    void (async () => {
      try {
        const res = await fetch('/api/teams');
        if (!res.ok) return;
        const data = (await res.json()) as { teams: MyTeam[] };
        setMyTeams(data.teams ?? []);
      } catch {
        // ignore
      }
    })();
  }, [enabled]);

  if (enabled !== true) return null;

  const sharedTeamIds = new Set(shares.map((s) => s.teamId));
  const candidateTeams = myTeams.filter((t) => !sharedTeamIds.has(t.id));

  const onShare = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/policies/${policyId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId: selected, permission }),
      });
      if (!res.ok) {
        setError(t('addFailed'));
        return;
      }
      setSelected('');
      await loadShares();
    } catch {
      setError(t('addFailed'));
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (teamId: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/policies/${policyId}/shares?teamId=${encodeURIComponent(teamId)}`,
        { method: 'DELETE' },
      );
      if (!res.ok) {
        setError(t('revokeFailed'));
        return;
      }
      setShares((prev) => prev.filter((s) => s.teamId !== teamId));
    } catch {
      setError(t('revokeFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardBody className="pt-6">
        <Stack gap={4}>
          <Stack gap={1}>
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
              {t('title')}
            </h2>
            <p className="text-sm text-fg-muted">{t('subtitle')}</p>
          </Stack>

          {/* Add-share row */}
          <Stack direction="row" gap={2} align="end" wrap>
            <div className="flex flex-col gap-2 min-w-0 flex-1">
              <Label htmlFor="share-team-select">{t('selectTeam')}</Label>
              <Select
                id="share-team-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                disabled={candidateTeams.length === 0 || busy}
              >
                <option value="">
                  {candidateTeams.length === 0
                    ? t('noEligibleTeams')
                    : t('placeholderSelect')}
                </option>
                {candidateTeams.map((tm) => (
                  <option key={tm.id} value={tm.id}>
                    {tm.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-2 w-40 shrink-0">
              <Label htmlFor="share-permission-select">
                {t('permissionLabel')}
              </Label>
              <Select
                id="share-permission-select"
                value={permission}
                onChange={(e) => setPermission(e.target.value as SharePermission)}
                disabled={busy}
              >
                <option value="view">{t('permissionView')}</option>
                <option value="execute">{t('permissionExecute')}</option>
              </Select>
            </div>
            <button
              type="button"
              onClick={onShare}
              disabled={!selected || busy}
              className={cn(
                buttonVariants({ variant: 'primary', size: 'md' }),
                'shrink-0 disabled:opacity-50',
              )}
            >
              {busy ? t('sharing') : t('share')}
            </button>
          </Stack>
          <p className="text-xs text-fg-subtle">{t('permissionHelp')}</p>

          {error && (
            <p className="text-xs text-danger" role="alert">
              {error}
            </p>
          )}

          {/* Current shares */}
          {shares.length > 0 && (
            <ul className="flex flex-col gap-2">
              {shares.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle p-3"
                >
                  <Stack gap={1} className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">
                      {s.teamName}
                    </p>
                    <Badge
                      variant={s.permission === 'execute' ? 'success' : 'neutral'}
                    >
                      {s.permission === 'execute'
                        ? t('permissionExecute')
                        : t('permissionView')}
                    </Badge>
                  </Stack>
                  <button
                    type="button"
                    onClick={() => onRevoke(s.teamId)}
                    disabled={busy}
                    className={cn(
                      buttonVariants({ variant: 'secondary', size: 'sm' }),
                      'shrink-0 disabled:opacity-50',
                    )}
                  >
                    {t('revoke')}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}
