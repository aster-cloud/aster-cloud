'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Stack, Toggle } from '@/components/ui';
import { locales, localeNames, defaultLocale, type Locale } from '@/i18n/config';
import { useAvailableLexicons } from '@/hooks/useAvailableLexicons';
import { backendAvailableLocales, uiLocaleToLexiconId } from '@/lib/lexicon-locale';

/**
 * 平台级语言可用性卡片（系统全局管理员，最高优先级）。
 *
 * 控制哪些 UI 语言在**整个平台**（aster-lang.cloud + aster-lang.dev）开放。
 *
 * 真相源 = 后端 lexicon 可用性（/api/v1/lexicons，SSE 实时）。每行一个语种，
 * 右侧 Toggle 即点即生效：乐观翻转 → POST `/api/admin/lexicons/{id}`（enable/
 * disable）→ 失败回滚。落到后端 LexiconRegistry（全局、跨 replica、SSE 广播），
 * 两端语言切换器各自读 /api/v1/lexicons 同步增减，dev 无需重新部署。
 *
 * 交互与同区块的 FeatureFlagsCard 一致（每行独立乐观 toggle），取代了旧的
 * 「复选框 + 全局 Save 按钮」混合模型。
 *
 * 默认语言（en）始终启用且其 Toggle 禁用——下线默认语言会让无可回退的 UI 崩塌。
 */
export function PlatformLanguageCard() {
  const t = useTranslations('platformLanguageSettings');

  // 后端当前可用集（SSE 实时）。这是显示的真相源。
  const { lexicons, loading: lexLoading } = useAvailableLexicons();
  const backendLocales = useMemo(() => backendAvailableLocales(lexicons), [lexicons]);
  // null = 后端尚未返回 → 视为全开（避免误判全部下线），由 loading 态盖住。
  const backendSet = useMemo(
    () => new Set(backendLocales ?? locales),
    [backendLocales],
  );

  // 进行中的乐观覆盖：locale → 目标 enabled 值。请求成功后保留覆盖（避免被尚未
  // 反映本次变更的旧 SSE 帧回跳），等收敛 effect 检测到后端集已等于目标值再移除；
  // 请求失败立即移除（回滚到后端现状）。同时该 map 的 key 驱动该行 Toggle 禁用态。
  const [pending, setPending] = useState<Map<Locale, boolean>>(new Map());
  const [error, setError] = useState('');

  // 超时兜底计时器（locale → timer）。POST 成功后若 SSE 长期不收敛（断连/丢帧），
  // 兜底强制清掉乐观覆盖，避免该行 Toggle 永久 busy。收敛 effect 提前清掉时一并取消。
  const fallbackTimers = useRef<Map<Locale, ReturnType<typeof setTimeout>>>(new Map());

  const clearPending = (loc: Locale) => {
    const timer = fallbackTimers.current.get(loc);
    if (timer) {
      clearTimeout(timer);
      fallbackTimers.current.delete(loc);
    }
    setPending((m) => {
      if (!m.has(loc)) return m;
      const n = new Map(m);
      n.delete(loc);
      return n;
    });
  };

  // 卸载时清掉所有兜底计时器。
  useEffect(() => {
    const timers = fallbackTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const loading = lexLoading && backendLocales === null;

  // 某语种当前是否启用：进行中以乐观目标为准，否则以后端现状为准。
  const isEnabled = (loc: Locale): boolean =>
    pending.has(loc) ? pending.get(loc)! : backendSet.has(loc);

  // 收敛：后端集已等于某乐观目标 → 本次开关被后端确认 → 移除覆盖（连带取消兜底
  // 计时器），交回 SSE 真相。
  useEffect(() => {
    if (pending.size === 0) return;
    let changed = false;
    const next = new Map(pending);
    for (const [loc, target] of pending) {
      if (backendSet.has(loc) === target) {
        next.delete(loc);
        const timer = fallbackTimers.current.get(loc);
        if (timer) {
          clearTimeout(timer);
          fallbackTimers.current.delete(loc);
        }
        changed = true;
      }
    }
    // 后端(SSE)现状确认了乐观目标后，清除对应覆盖——将本地乐观状态与外部真相收敛；
    // 有 changed 守卫，非每渲染无条件触发，属合法的外部状态→本地状态同步。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (changed) setPending(next);
  }, [backendSet, pending]);

  const toggle = async (loc: Locale, next: boolean) => {
    if (loc === defaultLocale) return; // 默认语言不可关闭
    setError('');
    setPending((m) => new Map(m).set(loc, next));
    try {
      const id = uiLocaleToLexiconId(loc);
      const res = await fetch(`/api/admin/lexicons/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: next ? 'enable' : 'disable' }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      // 成功：保留乐观覆盖等收敛 effect 在 SSE 推进后清除；同时挂超时兜底，
      // 防 SSE 断连/丢帧导致该行永久 busy（10s 后强制交回 SSE 真相）。
      // 先清掉该行可能存在的旧计时器（快速重复 toggle），避免计时器泄漏。
      const prev = fallbackTimers.current.get(loc);
      if (prev) clearTimeout(prev);
      const timer = setTimeout(() => clearPending(loc), 10_000);
      fallbackTimers.current.set(loc, timer);
    } catch {
      setError(t('saveFailed'));
      // 失败回滚：移除乐观覆盖（连带取消可能存在的旧计时器），行回到后端现状。
      clearPending(loc);
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
          {loading ? (
            <div className="h-6 w-32 animate-pulse rounded bg-bg-muted" />
          ) : (
            <ul className="flex flex-col gap-2" aria-label={t('title')}>
              {locales.map((loc) => {
                const isDefault = loc === defaultLocale;
                const enabled = isEnabled(loc);
                const busy = pending.has(loc);
                return (
                  <li
                    key={loc}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-bg-subtle p-3"
                  >
                    <Stack gap={1} className="min-w-0 flex-1">
                      <Stack direction="row" gap={2} align="center">
                        <p className="text-sm font-medium text-fg">
                          {localeNames[loc]}
                        </p>
                        <Badge variant={enabled ? 'success' : 'neutral'}>
                          {enabled ? t('enabledLabel') : t('disabledLabel')}
                        </Badge>
                      </Stack>
                      {isDefault && (
                        <p className="text-xs text-fg-muted">
                          {t('defaultLocaleNote')}
                        </p>
                      )}
                    </Stack>
                    <Toggle
                      checked={enabled}
                      onChange={(next) => toggle(loc, next)}
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
