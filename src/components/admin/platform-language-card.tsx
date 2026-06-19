'use client';

import { useEffect, useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Stack, buttonVariants, cn } from '@/components/ui';
import { locales, localeNames, defaultLocale, type Locale } from '@/i18n/config';
import { useAvailableLexicons } from '@/hooks/useAvailableLexicons';
import { backendAvailableLocales, uiLocaleToLexiconId } from '@/lib/lexicon-locale';

/** 两个 locale 集合是否相等（同元素）。用于编辑收敛检测与"有未保存改动"判断。 */
function setsEqual(a: ReadonlySet<Locale>, b: ReadonlySet<Locale>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

/**
 * 平台级语言可用性卡片（系统全局管理员，最高优先级）。
 *
 * 勾选哪些 UI 语言在**整个平台**（aster-lang.cloud + aster-lang.dev）开放。
 *
 * 真相源 = 后端 lexicon 可用性（/api/v1/lexicons）。保存即调
 * `/api/admin/lexicons/{id}` 对每个变更语种 enable/disable，落到后端
 * LexiconRegistry（全局、跨 replica、SSE 广播）。两端的语言切换器各自读
 * /api/v1/lexicons → 同步增减，dev 无需重新部署。
 *
 * 默认语言（en）始终启用且禁用其复选框——下线默认语言会让无可回退的 UI 崩塌。
 *
 * 不再写 cloud 自有的 platform-settings.i18n.enabled_locales：那只影响 cloud 自己、
 * dev 读不到，是历史上的第二真相源，现已由后端开关统一取代。
 */
export function PlatformLanguageCard() {
  const t = useTranslations('platformLanguageSettings');

  // 后端当前可用的 lexicon（SSE 实时）。这是显示与对比的真相源。
  const { lexicons, loading: lexLoading } = useAvailableLexicons();
  const backendLocales = useMemo(() => backendAvailableLocales(lexicons), [lexicons]);
  // 当前后端可用集（短码）。null = 后端尚未返回 → 视为全开（避免误判全部下线）。
  const backendSet = useMemo(
    () => (backendLocales === null ? new Set(locales) : new Set(backendLocales)),
    [backendLocales],
  );

  // 用户勾选的目标集。初始 = 后端当前可用集；后端帧到达后同步一次（仅在用户未改动时）。
  const [selected, setSelected] = useState<Set<Locale>>(new Set(locales));
  // edited=用户已 toggle 但尚未保存。保存中/后**不**清它，而是等 SSE 把后端集
  // 推进到与 selected 一致（收敛）时才放手——避免保存后被尚未反映本次变更的旧
  // SSE 帧回跳。toggle 置 true；收敛 effect 在一致时置 false。
  const [edited, setEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  // 保存成功后到 SSE 收敛前的等待窗：此期间按钮禁用并显示"同步中"，避免显示
  // 可点的 "Save"/"Saved" 却仍能重复提交同一目标态。收敛 effect 清 edited 时一并清。
  const [awaitingSync, setAwaitingSync] = useState(false);
  const [savedAt, setSavedAt] = useState(false);
  const [error, setError] = useState('');

  // SSE 真相同步：仅当用户未编辑且未在保存时，把勾选同步为后端现状。
  // 一旦用户 toggle 或正在保存，selected 是权威，不被 SSE 覆盖。
  // 收敛检测：后端集已等于 selected → 本次保存被后端确认 → 清 edited，交回 SSE。
  useEffect(() => {
    if (saving) return;
    if (!edited) {
      // 仅在确有差异时 setState，避免 selected 进 deps 后的重渲染循环。
      if (!setsEqual(backendSet, selected)) setSelected(new Set(backendSet));
      return;
    }
    if (setsEqual(backendSet, selected)) {
      setEdited(false);
      setAwaitingSync(false); // 后端已收敛到目标态，结束等待窗
    }
  }, [backendSet, edited, saving, selected]);

  const toggle = (loc: Locale) => {
    if (loc === defaultLocale) return; // 默认语言不可关闭
    setAwaitingSync(false); // 用户重新编辑，退出上一次保存的等待窗
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(loc)) next.delete(loc);
      else next.add(loc);
      return next;
    });
    setEdited(true);
    setSavedAt(false);
  };

  const save = async () => {
    setSaving(true);
    setError('');
    setSavedAt(false);

    // 冻结编辑基线：用保存开始瞬间的后端集做 diff，不读编辑期间被 SSE 改动的
    // 实时值，避免 diff 算错。默认语言永远 enable，不参与 disable。
    const baseline = new Set(backendSet);
    const target = new Set(selected);
    const changes: Array<{ loc: Locale; action: 'enable' | 'disable' }> = [];
    for (const loc of locales) {
      if (loc === defaultLocale) continue;
      const want = target.has(loc);
      const have = baseline.has(loc);
      if (want !== have) {
        changes.push({ loc, action: want ? 'enable' : 'disable' });
      }
    }

    try {
      // 串行执行：开关次数少（≤3），串行让审计日志顺序清晰、失败定位简单。
      for (const { loc, action } of changes) {
        const id = uiLocaleToLexiconId(loc);
        const res = await fetch(`/api/admin/lexicons/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action }),
        });
        if (!res.ok) throw new Error(`${action} ${id} → ${res.status}`);
      }
      // 不清 edited：保持 selected 为目标态显示，等 SSE 收敛到 target 后收敛
      // effect 自动清 edited。这样保存成功后 UI 不会被旧 SSE 帧回跳。
      setAwaitingSync(true); // 进入等待窗：按钮禁用+显示同步中，直到 SSE 收敛
      setSavedAt(true);
      setTimeout(() => setSavedAt(false), 3000);
    } catch {
      setError(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const loading = lexLoading && backendLocales === null;
  // 有未保存改动 = selected 与后端现状不一致。保存按钮据此启用/禁用。
  const hasChanges = !setsEqual(selected, backendSet);

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
                  </label>
                );
              })}
            </fieldset>
          )}
          <div>
            <button
              type="button"
              onClick={save}
              disabled={loading || saving || awaitingSync || !hasChanges}
              className={cn(buttonVariants({ variant: 'primary', size: 'sm' }), 'disabled:opacity-50')}
            >
              {saving || awaitingSync ? t('saving') : savedAt ? t('saved') : t('save')}
            </button>
          </div>
        </Stack>
      </CardBody>
    </Card>
  );
}
