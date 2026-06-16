'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Stack, buttonVariants, cn } from '@/components/ui';
import { locales, localeNames, defaultLocale, type Locale } from '@/i18n/config';
import { useAvailableLexicons } from '@/hooks/useAvailableLexicons';
import { backendAvailableLocales } from '@/lib/lexicon-locale';

const ENABLED_LOCALES_KEY = 'i18n.enabled_locales';

interface SettingsMap {
  [label: string]: { key: string; value: unknown };
}

/**
 * 平台级语言可用性卡片（系统全局管理员，最高优先级）。
 *
 * 勾选哪些 UI 语言在整个平台开放。团队语言设定是此设定的**子集**——团队无法
 * 开放此处未勾选的语言。默认语言（en）始终启用且禁用其复选框。
 *
 * 值存于 platform-settings 的 `i18n.enabled_locales`：locale 数组，`null` = 全部开放。
 * 读/写都走通用 `/api/admin/platform-settings`（requireAdmin）。
 */
export function PlatformLanguageCard() {
  const t = useTranslations('platformLanguageSettings');
  // null = 全部开放（初始视为全选）
  const [selected, setSelected] = useState<Set<Locale>>(new Set(locales));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState('');

  // 后端当前可用的 lexicon（SSE 实时）。运维热插拔/卸载 lexicon 时实时反映。
  const { lexicons } = useAvailableLexicons();
  const backendSet = useMemo(() => {
    const avail = backendAvailableLocales(lexicons);
    return avail === null ? null : new Set(avail);
  }, [lexicons]);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/platform-settings');
      if (!res.ok) throw new Error('failed');
      const data = (await res.json()) as { settings: SettingsMap };
      const entry = Object.values(data.settings).find((e) => e.key === ENABLED_LOCALES_KEY);
      const raw = entry?.value;
      if (!raw || !Array.isArray(raw)) {
        setSelected(new Set(locales)); // null = 全部开放
      } else {
        const valid = raw.filter((l): l is Locale => (locales as readonly string[]).includes(l));
        const set = new Set<Locale>(valid);
        set.add(defaultLocale);
        setSelected(set);
      }
    } catch {
      setError(t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (loc: Locale) => {
    if (loc === defaultLocale) return; // 默认语言不可关闭
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(loc)) next.delete(loc);
      else next.add(loc);
      return next;
    });
    setSavedAt(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setSavedAt(false);
    // 全选 → 存 null（= 不限制）；否则按 config 顺序存数组。
    const value: Locale[] | null =
      selected.size >= locales.length ? null : locales.filter((l) => selected.has(l));
    try {
      const res = await fetch('/api/admin/platform-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: ENABLED_LOCALES_KEY, value }),
      });
      if (!res.ok) throw new Error('failed');
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 3000);
    } catch {
      setError(t('saveFailed'));
    } finally {
      setSaving(false);
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
            <p className="text-sm text-fg-muted">{t('description')}</p>
          </Stack>
          {error && <p className="text-sm text-red-600">{error}</p>}
          {loading ? (
            <div className="h-6 w-32 animate-pulse rounded bg-bg-muted" />
          ) : (
            <fieldset className="flex flex-col gap-2" aria-label={t('title')}>
              {locales.map((loc) => {
                const isDefault = loc === defaultLocale;
                const checked = selected.has(loc);
                // backendSet=null 表示后端尚未返回 → 不据此判断不可用（视为可用）。
                const backendDown = backendSet !== null && !backendSet.has(loc) && !isDefault;
                return (
                  <label
                    key={loc}
                    className="flex items-center gap-3 text-sm text-fg cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={isDefault || saving}
                      onChange={() => toggle(loc)}
                      className="h-4 w-4 rounded border-border-strong text-primary focus:ring-primary disabled:opacity-60"
                    />
                    <span>{localeNames[loc]}</span>
                    <Badge variant={checked ? 'success' : 'neutral'}>
                      {checked ? t('enabledLabel') : t('disabledLabel')}
                    </Badge>
                    {isDefault && (
                      <span className="text-xs text-fg-subtle">— {t('defaultLocaleNote')}</span>
                    )}
                    {backendDown && (
                      // 后端没加载该 lexicon：即便平台勾选，用户也看不到（语言切换器还要 ∩ backend）。
                      <Badge variant="neutral">{t('backendUnavailable')}</Badge>
                    )}
                  </label>
                );
              })}
            </fieldset>
          )}
          <div>
            <button
              type="button"
              onClick={save}
              disabled={loading || saving}
              className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'disabled:opacity-50')}
            >
              {saving ? t('saving') : savedAt ? t('saved') : t('save')}
            </button>
          </div>
        </Stack>
      </CardBody>
    </Card>
  );
}
