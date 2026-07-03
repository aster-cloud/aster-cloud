'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Stack, buttonVariants, cn } from '@/components/ui';

interface GrantRow {
  userId: string;
  email: string | null;
  name: string | null;
  granted: boolean;
}

export function StructuralAliasGrantsCard() {
  const t = useTranslations('admin.structuralAliasGrants');
  const [rows, setRows] = useState<GrantRow[]>([]);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/admin/structural-alias-grants');
      if (!res.ok) return;
      const data = (await res.json()) as { users: GrantRow[] };
      setRows(data.users);
    })();
  }, []);

  const toggle = async (row: GrantRow) => {
    const next = !row.granted;
    setBusy((m) => ({ ...m, [row.userId]: true }));
    setRows((items) => items.map((item) => (
      item.userId === row.userId ? { ...item, granted: next } : item
    )));
    try {
      const res = await fetch('/api/admin/structural-alias-grants', {
        method: next ? 'POST' : 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: row.userId }),
      });
      if (!res.ok) {
        setRows((items) => items.map((item) => (
          item.userId === row.userId ? { ...item, granted: row.granted } : item
        )));
      }
    } catch {
      setRows((items) => items.map((item) => (
        item.userId === row.userId ? { ...item, granted: row.granted } : item
      )));
    } finally {
      setBusy((m) => ({ ...m, [row.userId]: false }));
    }
  };

  return (
    <Card>
      <CardBody className="pt-6">
        <Stack gap={4}>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
              {t('title')}
            </h2>
            <p className="mt-1 text-sm text-fg-muted">{t('description')}</p>
          </div>
          <ul className="flex max-h-80 flex-col gap-2 overflow-y-auto">
            {rows.map((row) => {
              const busyNow = busy[row.userId] ?? false;
              return (
                <li
                  key={row.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle p-3"
                >
                  <Stack gap={1} className="min-w-0 flex-1">
                    <Stack direction="row" gap={2} align="center">
                      <p className="truncate text-sm font-medium text-fg">
                        {row.email ?? row.name ?? row.userId}
                      </p>
                      <Badge variant={row.granted ? 'success' : 'neutral'}>
                        {row.granted ? t('granted') : t('notGranted')}
                      </Badge>
                    </Stack>
                    <p className="truncate text-xs text-fg-muted">{row.userId}</p>
                  </Stack>
                  <button
                    type="button"
                    onClick={() => toggle(row)}
                    disabled={busyNow}
                    className={cn(
                      buttonVariants({
                        variant: row.granted ? 'secondary' : 'primary',
                        size: 'sm',
                      }),
                      'disabled:opacity-50',
                    )}
                  >
                    {busyNow ? t('saving') : row.granted ? t('revoke') : t('grant')}
                  </button>
                </li>
              );
            })}
          </ul>
        </Stack>
      </CardBody>
    </Card>
  );
}
