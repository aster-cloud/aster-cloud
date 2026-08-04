'use client';

import { useState } from 'react';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardBody,
  Container,
  PageHeader,
  Stack,
  cn,
} from '@/components/ui';
import {
  PLATFORM_SETTING_KEYS,
  ASSISTANT_INSTRUCTIONS_MAX_LEN,
} from '@/lib/platform-settings';
import { extractErrorMessage } from '@/lib/api/error-envelope';

interface Labels {
  title: string;
  subtitle: string;
  enabledLabel: string;
  enabledHint: string;
  disabledHint: string;
  instructionsLabel: string;
  instructionsHint: string;
  instructionsPlaceholder: string;
  constraintsNotice: string;
  save: string;
  saving: string;
  saved: string;
  saveFailed: string;
  tooLong: string;
  cacheNotice: string;
}

/**
 * 站内助手设置表单。
 *
 * <p>写入走既有的 `/api/admin/platform-settings`（`{ key, value }` upsert，
 * requireAdmin 已在路由内）——不新建端点，与 runner-parity 等设置同一条通路。
 */
export function AssistantAdminContent({
  initialEnabled,
  initialInstructions,
  labels,
}: {
  initialEnabled: boolean;
  initialInstructions: string;
  labels: Labels;
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [instructions, setInstructions] = useState(initialInstructions);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const tooLong = instructions.length > ASSISTANT_INSTRUCTIONS_MAX_LEN;

  async function put(key: string, value: unknown) {
    const res = await fetch('/api/admin/platform-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });
    if (!res.ok) throw new Error((await extractErrorMessage(res)) ?? `HTTP ${res.status}`);
  }

  async function handleSave() {
    if (tooLong) return;
    setSaving(true);
    setStatus('idle');
    setError(null);
    try {
      // 两个键分别 upsert（该端点是单键接口）。开关先写：即便第二个失败，
      // 「已关闭」也已生效——止血优先于文案。
      await put(PLATFORM_SETTING_KEYS.ASSISTANT_ENABLED, enabled);
      await put(PLATFORM_SETTING_KEYS.ASSISTANT_EXTRA_INSTRUCTIONS, instructions.trim());
      setStatus('saved');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Container size="xl" className="py-6 sm:py-10">
      <PageHeader title={labels.title} subtitle={labels.subtitle} className="mb-6" />
      <Stack gap={6}>
        {/* 总开关 */}
        <Card>
          <CardBody className="pt-6">
            <Stack direction="row" justify="between" align="center" gap={4}>
              <Stack gap={1}>
                <p className="text-sm font-medium text-fg">{labels.enabledLabel}</p>
                <p className="text-sm text-fg-muted">
                  {enabled ? labels.enabledHint : labels.disabledHint}
                </p>
              </Stack>
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={labels.enabledLabel}
                onClick={() => setEnabled((v) => !v)}
                className={cn(
                  'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
                  'transition-colors duration-fast ease-standard',
                  'focus-visible:outline-none focus-visible:shadow-ring',
                  enabled ? 'bg-primary' : 'bg-bg-muted',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'pointer-events-none inline-block size-5 transform rounded-full bg-bg shadow ring-0',
                    'transition-transform duration-fast ease-standard',
                    enabled ? 'translate-x-5' : 'translate-x-0',
                  )}
                />
              </button>
            </Stack>
          </CardBody>
        </Card>

        {/* 附加指令 */}
        <Card>
          <CardBody className="pt-6">
            <Stack gap={4}>
              <Stack gap={1}>
                <label htmlFor="assistant-instructions" className="text-sm font-medium text-fg">
                  {labels.instructionsLabel}
                </label>
                <p className="text-sm text-fg-muted">{labels.instructionsHint}</p>
              </Stack>

              {/* ★把"改不了什么"写在界面上：管理员不该在试过之后才发现
                  自己写的"不用给链接"没生效。 */}
              <Alert>
                <AlertDescription>{labels.constraintsNotice}</AlertDescription>
              </Alert>

              <textarea
                id="assistant-instructions"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder={labels.instructionsPlaceholder}
                rows={6}
                className="w-full rounded-md border border-border bg-bg-soft px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-primary"
              />
              <p className={cn('text-xs', tooLong ? 'text-danger' : 'text-fg-subtle')}>
                {instructions.length} / {ASSISTANT_INSTRUCTIONS_MAX_LEN}
                {tooLong ? ` — ${labels.tooLong}` : ''}
              </p>

              <p className="text-xs text-fg-subtle">{labels.cacheNotice}</p>

              <Stack direction="row" align="center" gap={3}>
                <Button onClick={handleSave} disabled={saving || tooLong}>
                  {saving ? labels.saving : labels.save}
                </Button>
                {status === 'saved' && (
                  <span className="text-sm text-fg-muted">{labels.saved}</span>
                )}
              </Stack>

              {status === 'error' && (
                <Alert variant="danger">
                  <AlertDescription>
                    {labels.saveFailed}
                    {error ? `：${error}` : ''}
                  </AlertDescription>
                </Alert>
              )}
            </Stack>
          </CardBody>
        </Card>
      </Stack>
    </Container>
  );
}
