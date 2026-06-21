'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Stack, Toggle } from '@/components/ui';
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
 * 团队 owner/admin 控制哪些 UI 语言开放给团队用户。`selectable` 是编译支持全集；
 * 后端 lexicon 注册表才是平台真相，切换器会与它求交。默认语言始终启用且禁用其 Toggle。
 *
 * 交互**与 PlatformLanguageCard 一致**：每行一个 Toggle，即点即生效（乐观翻转 →
 * PUT `/api/teams/[teamId]/locales` 全量白名单 → 失败回滚），**无全局 Save 按钮**。
 * 与平台卡的差异：团队白名单存团队 DB（非全局 lexicon 注册表，无 SSE），故乐观状态
 * 由 PUT 返回的权威 enabled 直接收敛，不需 SSE 收敛/兜底计时器。
 * `enabled === null` 表示"全部开放"——初始全选。
 *
 * **可勾选集 = 平台已启用集的子集**：团队层是平台层的子集（团队不能开放平台未启用
 * 的语言）。平台启用 = 后端 lexicon 注册表（/api/v1/lexicons，SSE 实时）。故 `selectable`
 * 由 `backendSet`（平台已启用，随 SSE 动态变）∩ 编译集驱动，**随平台开关动态调整**——
 * 平台禁某语言 → 该行从团队卡消失。默认语言始终在内（防锁死）。
 */
export function TeamLanguageCard({ teamId }: { teamId: string }) {
  const t = useTranslations('languageSettings');
  // 右上角语言切换器的 allowedLocales 由 dashboard layout 的 server component
  // （resolveUserAllowedLocales）一次性渲染。团队白名单改动是客户端 PUT 到团队 DB，
  // 不经 SSE → 切换器的 allowedLocales 会停在页面加载时的旧值。保存成功后 router.refresh()
  // 重跑 server component 拉取最新团队白名单，让切换器即时反映新启用的语言（无需手动刷新）。
  const router = useRouter();
  const [defaultLocale, setDefaultLocale] = useState<Locale>('en');
  // 团队当前白名单（enabled === null 时初始为可勾选全集）。
  const [selected, setSelected] = useState<Set<Locale>>(new Set(locales));
  // enabled === null（未配置=全部开放）需要记住，以便平台启用新语言时团队自动跟开。
  const [allOpen, setAllOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  // 进行中的行（locale 集）：该行 Toggle 禁用 + 防并发重复提交。
  const [pending, setPending] = useState<Set<Locale>>(new Set());
  const [error, setError] = useState('');

  // 后端实时可用 lexicon（SSE）= **平台已启用集**。团队可勾选集是它的子集。
  const { lexicons, loading: lexLoading } = useAvailableLexicons();
  const backendLocales = useMemo(() => backendAvailableLocales(lexicons), [lexicons]);

  // 可勾选集 = 平台已启用（backend）∩ 编译集，**始终含 defaultLocale**（防锁死）。
  // backend 尚未返回（null）时退回编译全集，由 loading 态盖住。随 SSE 动态调整。
  const selectable = useMemo<Locale[]>(() => {
    const platform = backendLocales ?? [...locales];
    const set = new Set<Locale>(platform);
    set.add(defaultLocale);
    return locales.filter((l) => set.has(l));
  }, [backendLocales, defaultLocale]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/teams/${teamId}/locales`);
      const data = (await res.json()) as LocalesResponse;
      if (!res.ok) throw new Error(extractErrorMessage(data) || 'failed');
      setDefaultLocale(data.defaultLocale);
      setAllOpen(data.enabled === null);
      // enabled === null = 全部开放 → 选中可勾选全集（实际显示集由 selectable 求交）。
      setSelected(new Set(data.enabled ?? data.selectable ?? data.compiled));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed');
    } finally {
      setLoading(false);
    }
  }, [teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const loading2 = loading || (lexLoading && backendLocales === null);

  // 某行当前是否启用：allOpen（未配置=全部开放）下所有可勾选行都视为开；否则看 selected。
  const isRowEnabled = (loc: Locale): boolean => allOpen || selected.has(loc);

  // 即点即生效：乐观翻转该行 → PUT 全量白名单 → 用返回的权威 enabled 收敛；失败回滚。
  // allOpen 状态下首次显式 toggle 把"全部开放"具化为可勾选全集再增减（用户做了显式选择，
  // 脱离 null=全开）。提交的白名单只含**可勾选集**（平台已启用），不会把平台禁的语言写回。
  //
  // **串行化（防并发覆盖）**：团队接口是全量白名单 PUT（非平台卡的 per-lexicon POST），
  // 不同行并发 PUT 会用各自的旧 base 互相覆盖、丢更新。故有 PUT 在途（pending 非空）时
  // 禁用所有行 toggle（见 disabled），保证同一时刻只有一个 PUT。
  const toggle = async (loc: Locale, next: boolean) => {
    if (loc === defaultLocale) return; // 默认语言不可关闭
    if (pending.size > 0) return; // 有 PUT 在途 → 串行化，丢弃本次（按钮已 disabled，双保险）
    setError('');

    const prevSelected = selected;
    const prevAllOpen = allOpen;
    // 基线：allOpen 时具化为可勾选全集；否则取当前 selected 与可勾选集求交（剔除平台已禁的）。
    const selectableSet = new Set(selectable);
    const base = allOpen
      ? new Set(selectable)
      : new Set([...prevSelected].filter((l) => selectableSet.has(l)));
    if (next) base.add(loc);
    else base.delete(loc);

    setAllOpen(false);
    setSelected(base);
    setPending((p) => new Set(p).add(loc));

    try {
      const res = await fetch(`/api/teams/${teamId}/locales`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: [...base] }),
      });
      const data = (await res.json()) as LocalesResponse;
      if (!res.ok) throw new Error(extractErrorMessage(data) || 'failed');
      // 收敛到后端权威值（enabled === null = 全部开放 → 标记 allOpen）。
      setAllOpen(data.enabled === null);
      setSelected(new Set(data.enabled ?? selectable));
      // 重跑 dashboard layout 的 server component → 切换器 allowedLocales 即时反映本次改动
      // （否则新启用的语言要手动刷新页面才出现在右上角下拉）。
      router.refresh();
    } catch (err) {
      // 失败回滚到提交前状态。
      setSelected(prevSelected);
      setAllOpen(prevAllOpen);
      setError(err instanceof Error ? err.message : t('saveFailed'));
    } finally {
      setPending((p) => {
        const n = new Set(p);
        n.delete(loc);
        return n;
      });
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
          {error && <p className="text-sm text-danger">{error}</p>}
          {loading2 ? (
            <div className="h-6 w-32 animate-pulse rounded bg-bg-muted" />
          ) : (
            <ul className="flex flex-col gap-2" aria-label={t('title')}>
              {/* 串行化：任一行 PUT 在途时禁用所有行（团队接口是全量白名单 PUT，
                  并发会互相覆盖丢更新）。同时该行显式标记 busy 给出反馈。 */}
              {selectable.map((loc) => {
                const isDefault = loc === defaultLocale;
                const enabled = isRowEnabled(loc);
                const busy = pending.size > 0;
                return (
                  <li
                    key={loc}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle p-3"
                  >
                    <Stack gap={1} className="min-w-0 flex-1">
                      <Stack direction="row" gap={2} align="center">
                        <p className="text-sm font-medium text-fg">{localeNames[loc]}</p>
                        <Badge variant={enabled ? 'success' : 'neutral'}>
                          {enabled ? t('enabledLabel') : t('disabledLabel')}
                        </Badge>
                      </Stack>
                      {isDefault && (
                        <p className="text-xs text-fg-muted">{t('defaultLocaleNote')}</p>
                      )}
                    </Stack>
                    <Toggle
                      checked={enabled}
                      onChange={(nextVal) => toggle(loc, nextVal)}
                      disabled={isDefault || busy}
                      ariaLabel={t('toggleAriaLabel', { language: localeNames[loc] })}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}
