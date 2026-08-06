'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { extractErrorMessage } from '@/lib/api/error-envelope';
import {
  Breadcrumbs,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CardDescription,
  ConfirmDialog,
  Container,
  PageHeader,
  Stack,
  toast,
} from '@/components/ui';

/**
 * Client island for /settings/data.
 *
 * Two cards: download (GET /api/user/ai-data-export, Article 15)
 * and erase (DELETE /api/user/ai-data, Article 17). The two paths
 * are separated on purpose — putting export on the same route as
 * erase would let a curl GET accidentally trip the erasure handler
 * via method-confusion bugs. Two paths, two methods, two intents.
 */
export function DataContent() {
  const t = useTranslations('settings.dataPage');
  const tSettings = useTranslations('settings');
  const [confirmErase, setConfirmErase] = useState(false);
  const [isErasing, setIsErasing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  const downloadJson = async () => {
    setIsDownloading(true);
    try {
      // GDPR Article 15 export endpoint. The sibling /ai-data path
      // is DELETE-only — GET against it returns 405.
      const res = await fetch('/api/user/ai-data-export');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(t('downloadFailure', { error: extractErrorMessage(data) || res.status }));
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      a.download = `aster-ai-data-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        t('downloadFailure', {
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    } finally {
      setIsDownloading(false);
    }
  };

  const eraseContent = async () => {
    setIsErasing(true);
    try {
      const res = await fetch('/api/user/ai-data', { method: 'DELETE' });
      const data = (await res.json().catch(() => ({}))) as {
        records_cleared?: number;
        error?: string;
      };
      if (!res.ok) {
        toast.error(t('deleteCard.failure', { error: extractErrorMessage(data) || res.status }));
        return;
      }
      toast.success(
        t('deleteCard.success', { count: data.records_cleared ?? 0 }),
      );
      setConfirmErase(false);
    } finally {
      setIsErasing(false);
    }
  };

  return (
    <Container size="xl" className="py-6 sm:py-10">
      <Stack gap={6}>
        <PageHeader
          breadcrumbs={
            <Breadcrumbs
              items={[
                { label: tSettings('title'), href: '/settings' },
                { label: t('breadcrumb') },
              ]}
            />
          }
          title={t('title')}
          subtitle={t('subtitle')}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t('downloadCard.title')}</CardTitle>
            <CardDescription>{t('downloadCard.body')}</CardDescription>
          </CardHeader>
          <CardBody>
            <Button
              variant="primary"
              onClick={downloadJson}
              disabled={isDownloading}
            >
              {t('downloadCard.action')}
            </Button>
          </CardBody>
        </Card>

        <Card className="border-danger/40">
          <CardHeader>
            <CardTitle className="text-danger">
              {t('deleteCard.title')}
            </CardTitle>
            <CardDescription>{t('deleteCard.body')}</CardDescription>
          </CardHeader>
          <CardBody>
            <Button
              variant="destructive"
              onClick={() => setConfirmErase(true)}
            >
              {t('deleteCard.action')}
            </Button>
          </CardBody>
        </Card>

        {/* ★回放明文授权（第九轮 P0-8：此前该开关无任何写入口，
            依赖它的 What-if 永远无法自助开启）。
            语义是**使用授权**不是存储开关——Execution.input 无条件写入。 */}
        <ReplayRetentionCard />
      </Stack>

      <ConfirmDialog
        isOpen={confirmErase}
        title={t('deleteCard.confirmTitle')}
        // The count is server-known, so we pass `count: -1` here as a
        // placeholder — the success toast uses the real count.
        description={t('deleteCard.confirmBody', { count: 0 })}
        confirmLabel={t('deleteCard.confirmAction')}
        cancelLabel={t('deleteCard.confirmCancel')}
        variant="danger"
        isLoading={isErasing}
        onConfirm={eraseContent}
        onCancel={() => !isErasing && setConfirmErase(false)}
      />
    </Container>
  );
}

/**
 * 回放明文授权开关。
 *
 * <p>控制 {@code User.replayRetentionEnabled}：是否允许平台把**已存在的**
 * 历史执行明文输入用于重跑分析（What-if / 回归工具）。
 *
 * <p>★措辞必须准确：它不是「是否保存明文」——`Execution.input` 是无条件
 * 写入的。把使用授权说成存储开关会让用户以为关掉就不存数据（第九轮 P0-8）。
 */
function ReplayRetentionCard() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/user/replay-retention')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: { enabled: boolean }) => {
        if (!cancelled) setEnabled(j.enabled);
      })
      .catch(() => {
        if (!cancelled) setError('load-failed');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const toggle = async (next: boolean) => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user/replay-retention', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const j = (await res.json()) as { enabled: boolean };
      setEnabled(j.enabled);
    } catch {
      setError('save-failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="text-base font-medium text-fg">Replay authorization</h2>
      </CardHeader>
      <CardBody>
        <Stack gap={3}>
          <p className="text-sm text-fg-muted">
            Allow the platform to re-run your historical execution inputs for analysis
            (What-if estimates, regression checks). This authorizes <em>use</em> of inputs
            that are already stored — it does not change what is stored.
          </p>
          {enabled === null && !error && (
            <p className="text-sm text-fg-subtle">Loading…</p>
          )}
          {enabled !== null && (
            <Stack direction="row" align="center" gap={3}>
              <Button
                variant={enabled ? 'secondary' : 'primary'}
                disabled={saving}
                onClick={() => toggle(!enabled)}
              >
                {enabled ? 'Disable' : 'Enable'}
              </Button>
              <span className="text-sm text-fg-muted">
                Currently: {enabled ? 'enabled' : 'disabled'}
              </span>
            </Stack>
          )}
          {error && (
            <p className="text-sm text-danger">
              {error === 'load-failed' ? 'Could not load the setting.' : 'Could not save.'}
            </p>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}
