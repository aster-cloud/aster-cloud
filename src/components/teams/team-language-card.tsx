'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { locales, localeNames, type Locale } from '@/i18n/config';
import { extractErrorMessage } from '@/lib/api/error-envelope';
import { useAvailableLexicons } from '@/hooks/useAvailableLexicons';
import { backendAvailableLocales } from '@/lib/lexicon-locale';

interface LocalesResponse {
  compiled: Locale[];
  // 团队可勾选的 locale = 编译支持全集；后端 lexicon 决定真实可用性。
  selectable: Locale[];
  enabled: Locale[] | null;
  defaultLocale: Locale;
}

/**
 * 团队语言可用性卡片（ADR 0017）。
 *
 * 团队 owner/admin 勾选哪些 UI 语言开放给团队用户。`selectable` 是编译支持
 * 全集；后端 lexicon 注册表才是平台真相，切换器会与它求交。默认语言始终启用
 * 且禁用其复选框。`enabled === null` 表示"全部开放"——初始全选。
 *
 * 保存调用 PUT /api/teams/[teamId]/locales；后端 normalize 后落库。
 * 语言切换器据此过滤（compiled ∩ backend ∩ team-allowed）。
 */
export function TeamLanguageCard({ teamId }: { teamId: string }) {
  const t = useTranslations('languageSettings');
  const [defaultLocale, setDefaultLocale] = useState<Locale>('en');
  // 团队可勾选集；默认编译支持全集。
  const [selectable, setSelectable] = useState<Locale[]>([...locales]);
  const [selected, setSelected] = useState<Set<Locale>>(new Set(locales));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState('');

  // 后端实时可用 lexicon（SSE）。运维热插拔/卸载某语言时卡片实时标注。
  const { lexicons } = useAvailableLexicons();
  const backendSet = useMemo(() => {
    const avail = backendAvailableLocales(lexicons);
    return avail === null ? null : new Set(avail);
  }, [lexicons]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/teams/${teamId}/locales`);
      const data = (await res.json()) as LocalesResponse;
      if (!res.ok) throw new Error(extractErrorMessage(data) || 'failed');
      setDefaultLocale(data.defaultLocale);
      const sel = data.selectable ?? data.compiled;
      setSelectable(sel);
      // enabled === null = 全部开放 → 选中所有可勾选语言。
      setSelected(new Set(data.enabled ?? sel));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    load();
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
    try {
      const res = await fetch(`/api/teams/${teamId}/locales`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: [...selected] }),
      });
      const data = (await res.json()) as LocalesResponse;
      if (!res.ok) throw new Error(extractErrorMessage(data) || 'failed');
      setSelected(new Set(data.enabled ?? locales));
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-bg shadow rounded-lg mb-8">
      <div className="px-6 py-4 border-b border-border">
        <h2 className="text-lg font-medium text-fg">{t('title')}</h2>
        <p className="mt-1 text-sm text-fg-muted">{t('description')}</p>
      </div>
      <div className="px-6 py-4 space-y-3">
        {error && (
          <div className="rounded-md bg-red-50 p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {loading ? (
          <div className="h-6 w-32 animate-pulse rounded bg-bg-muted" />
        ) : (
          <fieldset className="space-y-2" aria-label={t('title')}>
            {selectable.map((loc) => {
              const isDefault = loc === defaultLocale;
              const checked = selected.has(loc);
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
                  <span className="text-xs text-fg-muted">
                    {checked ? t('enabledLabel') : t('disabledLabel')}
                  </span>
                  {isDefault && (
                    <span className="text-xs text-fg-subtle">— {t('defaultLocaleNote')}</span>
                  )}
                  {backendDown && (
                    <span className="text-xs text-amber-600">— {t('backendUnavailable')}</span>
                  )}
                </label>
              );
            })}
          </fieldset>
        )}
        <div className="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={save}
            disabled={loading || saving}
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? t('saving') : savedAt ? t('saved') : t('save')}
          </button>
        </div>
      </div>
    </div>
  );
}
