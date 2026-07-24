'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, Card, CardBody, Input, Label, Select, Stack } from '@/components/ui';

/*
 * Runner-parity 管理卡片（系统管理员）。
 *
 * 控制 cloud→launcher 影子校验（runner-parity）的触发策略。真相源 = 后端
 * platform-settings 两个键：runner_parity.mode（off|sampled|every|manual）+
 * runner_parity.sample_pct（0–100 整数，仅 sampled 生效）。
 *
 * ★诚实边界：runner-parity 是**只读影子信号**（log-only，绝不 gate 任何决策）。
 * 本卡片只调节它跑不跑、跑多勤——不改变任何 policy 执行结果。
 *
 * 交互沿用同区块 FeatureFlagsCard/PlatformLanguageCard：即改即存（乐观 + 失败
 * 回滚），命中后端已有的 POST /api/admin/platform-settings（值级校验在服务端，
 * mode 非法/pct 越界返 400，卡片回滚并显错）。mode 与 sample_pct 各自独立保存。
 *
 * i18n：文案键随 @aster-cloud/ui-messages 分发（ADR 0018，cloud 不手维护 messages）。
 * 键未到位时用 t.has() 探针回落内置英文——保证卡片在 messages 发版前即可用。
 */

const MODES = ['off', 'sampled', 'every', 'manual'] as const;
type Mode = (typeof MODES)[number];

const MODE_KEY = 'runner_parity.mode';
const PCT_KEY = 'runner_parity.sample_pct';

// 内置英文兜底（ui-messages 尚无键时用）。与服务端语义严格一致。
const FALLBACK: Record<string, string> = {
  title: 'Runner parity (shadow check)',
  description:
    'Controls the cloud→launcher shadow comparison. Log-only — it never gates any policy decision, only records match/divergent signals.',
  modeLabel: 'Trigger mode',
  // ★badge 用的短名与长描述分开键——避免从长文案里 split 出短名（翻译标点不同即碎）。
  'badge.off': 'Off',
  'badge.sampled': 'Sampled',
  'badge.every': 'Every',
  'badge.manual': 'Manual',
  'mode.off': 'Off — never run',
  'mode.sampled': 'Sampled — run on a percentage of executions',
  'mode.every': 'Every — run on every execution',
  // ★manual 触发点是 verify-parity API（PR-4 日志页仅显示 parity 徽章，无一键按钮）——文案不夸大。
  'mode.manual': 'Manual — only via the verify-parity API',
  sampleLabel: 'Sample percentage',
  sampleHint: 'Share of executions to check, 0–100. Only applies in Sampled mode.',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'Could not save. Reverted.',
};

interface SettingEntry {
  key: string;
  value: unknown;
}
interface SettingsResponse {
  settings: Record<string, SettingEntry>;
}

export function RunnerParityCard() {
  const t = useTranslations('admin.runnerParity');
  // t.has() 探针：键在 ui-messages 到位则用翻译，否则回落内置英文（不硬崩）。
  const tr = (k: string): string => (t.has(k) ? t(k) : FALLBACK[k] ?? k);

  const [mode, setMode] = useState<Mode>('off');
  const [samplePct, setSamplePct] = useState<number>(5);
  const [loading, setLoading] = useState(true);
  // ★per-key 独立保存状态（Codex 抓：mode/pct 可并发，单值状态会互相覆盖）。
  //   每键取值 'idle'|'saving'|'saved'|'error'——mode 失败不会被 pct 成功抹掉。
  type SaveState = 'idle' | 'saving' | 'saved' | 'error';
  const [saveState, setSaveState] = useState<{ mode: SaveState; pct: SaveState }>({
    mode: 'idle',
    pct: 'idle',
  });
  // ★per-key 请求版本号（Codex 抓 ABA）：只允许**最新**一发请求回滚/写状态/清 saving。
  //   条件回滚（cur===next）会被 A→B→A 的 ABA 击穿——版本号让迟到的旧请求彻底失效。
  //   用 ref 而非 state：递增/读取不触发渲染，且闭包捕获的是稳定引用。
  const reqVersion = useRef<{ mode: number; pct: number }>({ mode: 0, pct: 0 });

  // 初次加载：从后端读当前两键值（GET 返回全部已知键）。读失败保持默认（off/5）。
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/admin/platform-settings');
        if (!res.ok) return;
        const data = (await res.json()) as SettingsResponse;
        for (const entry of Object.values(data.settings)) {
          if (entry.key === MODE_KEY && typeof entry.value === 'string' && (MODES as readonly string[]).includes(entry.value)) {
            setMode(entry.value as Mode);
          }
          if (entry.key === PCT_KEY && typeof entry.value === 'number' && Number.isFinite(entry.value)) {
            setSamplePct(Math.min(100, Math.max(0, Math.floor(entry.value))));
          }
        }
      } catch {
        // 保持默认（off/5）——管理员可重试。
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /**
   * 单键保存核心：乐观已由调用方置好本地态；此处 POST，并用 per-key 版本号确保**只有最新一发**
   * 请求能改状态/回滚——旧请求（被后续编辑取代）迟到时整体作废，杜绝 ABA 陈旧回滚。
   * rollback 只在「本请求仍是最新」时执行（值层面用 setter 幂等；版本层面用 mine===latest 守卫）。
   */
  const saveKey = (
    field: 'mode' | 'pct',
    apiKey: string,
    value: unknown,
    rollback: () => void,
  ): void => {
    const mine = (reqVersion.current[field] += 1); // 领取本请求版本号
    setSaveState((s) => ({ ...s, [field]: 'saving' }));
    void (async () => {
      let ok = false;
      try {
        const res = await fetch('/api/admin/platform-settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: apiKey, value }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
      // ★过期请求（其后已有更新编辑）：整体作废——不回滚、不写状态、不清 saving（交给最新请求）。
      if (mine !== reqVersion.current[field]) return;
      if (!ok) rollback();
      setSaveState((s) => ({ ...s, [field]: ok ? 'saved' : 'error' }));
    })();
  };

  const onModeChange = (next: Mode): void => {
    const prev = mode;
    setMode(next);
    saveKey('mode', MODE_KEY, next, () => setMode(prev));
  };

  // sample_pct 失焦时保存（避免每次按键打一发）。夹到 0–100 整数——与服务端校验对齐。
  const onPctCommit = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10);
    const clamped = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
    if (clamped === samplePct) return; // 无变化不打请求
    const prev = samplePct;
    setSamplePct(clamped);
    saveKey('pct', PCT_KEY, clamped, () => setSamplePct(prev));
  };

  // 当前是否已启用（非 off）——驱动顶部 Badge。
  const enabled = mode !== 'off';
  // sample_pct 输入仅在 sampled 模式下有意义（其他模式禁用，但保留值不清）。
  const pctRelevant = mode === 'sampled';

  return (
    <Card>
      <CardBody className="pt-6">
        <Stack gap={4}>
          <Stack gap={1}>
            <Stack direction="row" gap={2} align="center">
              <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
                {tr('title')}
              </h2>
              <Badge variant={enabled ? 'success' : 'neutral'}>
                {tr(`badge.${mode}`)}
              </Badge>
            </Stack>
            <p className="text-sm text-fg-muted">{tr('description')}</p>
          </Stack>

          {loading ? (
            <div className="h-6 w-40 animate-pulse rounded bg-bg-muted" />
          ) : (
            <Stack gap={4}>
              {/* 模式选择 */}
              <Stack gap={1}>
                <Label htmlFor="runner-parity-mode">{tr('modeLabel')}</Label>
                <Select
                  id="runner-parity-mode"
                  value={mode}
                  onChange={(e) => onModeChange(e.target.value as Mode)}
                  disabled={saveState.mode === 'saving'}
                >
                  {MODES.map((m) => (
                    <option key={m} value={m}>
                      {tr(`mode.${m}`)}
                    </option>
                  ))}
                </Select>
              </Stack>

              {/* 采样百分比（仅 sampled 生效） */}
              <Stack gap={1}>
                <Label htmlFor="runner-parity-pct">{tr('sampleLabel')}</Label>
                <Input
                  id="runner-parity-pct"
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  defaultValue={samplePct}
                  key={`pct-${samplePct}`}
                  onBlur={(e) => onPctCommit(e.target.value)}
                  disabled={!pctRelevant || saveState.pct === 'saving'}
                  aria-describedby="runner-parity-pct-hint"
                />
                <p id="runner-parity-pct-hint" className="text-xs text-fg-muted">
                  {tr('sampleHint')}
                </p>
              </Stack>

              {/* 保存状态提示：per-key 独立行——mode 的错误不会被 pct 的成功抹掉（Codex 抓）。 */}
              <div className="min-h-[1.25rem] text-xs" aria-live="polite">
                <SaveStatusLine label={tr('modeLabel')} state={saveState.mode} tr={tr} />
                <SaveStatusLine label={tr('sampleLabel')} state={saveState.pct} tr={tr} />
              </div>
            </Stack>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}

/** 单键保存状态行：idle 不渲染；saving/saved/error 各自配色文案。per-key 独立不互相覆盖。 */
function SaveStatusLine({
  label,
  state,
  tr,
}: {
  label: string;
  state: 'idle' | 'saving' | 'saved' | 'error';
  tr: (k: string) => string;
}) {
  if (state === 'idle') return null;
  const cls =
    state === 'error' ? 'text-danger' : state === 'saved' ? 'text-success' : 'text-fg-muted';
  const msg = state === 'saving' ? tr('saving') : state === 'saved' ? tr('saved') : tr('saveFailed');
  return (
    <span className={`block ${cls}`}>
      {label}: {msg}
    </span>
  );
}
