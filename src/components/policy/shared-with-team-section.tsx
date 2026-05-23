'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge, Card, CardBody, Stack } from '@/components/ui';
import { formatDate } from '@/lib/format';

/*
 * "Shared with this team" section on /teams/[teamId]/policies.
 *
 * Self-gates: calls GET /api/teams/[teamId]/shared-policies on mount.
 * 404 → sharing disabled OR caller is not a team member; either way
 * we render nothing. Empty list → render nothing (don't litter the
 * page with an empty box).
 *
 * Permission tier comes from the share row itself; the API resolves
 * the highest-tier when a policy is shared multiple ways with this
 * team (currently impossible — one share per (policy, team) — but
 * the field stays accurate if that ever changes).
 */

type SharePermission = 'view' | 'execute';

interface SharedPolicy {
  shareId: string;
  policyId: string;
  policyName: string;
  policyDescription: string | null;
  permission: SharePermission;
  ownerName: string | null;
  updatedAt: string;
  createdAt: string;
}

interface Props {
  teamId: string;
  locale: string;
}

export function SharedWithTeamSection({ teamId, locale }: Props) {
  const t = useTranslations('teams.sharedPolicies');
  const [items, setItems] = useState<SharedPolicy[] | null>(null);
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/teams/${teamId}/shared-policies`);
        if (cancelled) return;
        if (res.status === 404) {
          setEnabled(false);
          return;
        }
        if (!res.ok) {
          setEnabled(false);
          return;
        }
        const data = (await res.json()) as { shares: SharedPolicy[] };
        setEnabled(true);
        setItems(data.shares);
      } catch {
        if (!cancelled) setEnabled(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [teamId]);

  if (enabled !== true || items === null || items.length === 0) return null;

  return (
    <Card className="mt-6">
      <CardBody className="pt-6">
        <Stack gap={4}>
          <Stack gap={1}>
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
              {t('title')}
            </h2>
            <p className="text-sm text-fg-muted">{t('subtitle')}</p>
          </Stack>
          <ul className="flex flex-col gap-2">
            {items.map((s) => (
              <li
                key={s.shareId}
                className="rounded-md border border-border bg-bg-subtle p-3 transition-colors hover:bg-bg-muted"
              >
                <Link
                  href={`/policies/${s.policyId}`}
                  className="block focus-visible:outline-none"
                >
                  <Stack gap={2}>
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-sm font-medium text-primary hover:underline">
                        {s.policyName}
                      </p>
                      <Badge
                        variant={s.permission === 'execute' ? 'success' : 'neutral'}
                      >
                        {s.permission === 'execute'
                          ? t('permissionExecute')
                          : t('permissionView')}
                      </Badge>
                    </div>
                    {s.policyDescription && (
                      <p className="truncate text-sm text-fg-muted">
                        {s.policyDescription}
                      </p>
                    )}
                    <p className="text-xs text-fg-subtle">
                      {s.ownerName && (
                        <>{t('fromOwner', { owner: s.ownerName })} · </>
                      )}
                      {t('sharedOn', {
                        date: formatDate(s.createdAt, locale),
                      })}
                    </p>
                  </Stack>
                </Link>
              </li>
            ))}
          </ul>
        </Stack>
      </CardBody>
    </Card>
  );
}
