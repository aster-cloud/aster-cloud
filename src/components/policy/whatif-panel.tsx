'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription, Card, CardBody, Stack } from '@/components/ui';
import type { Confidence, WhatIfEstimate } from '@/lib/analytics/whatif-estimate';

interface Labels {
  title: string;
  subtitle: string;
  loading: string;
  loadFailed: string;
  empty: string;
  emptyHint: string;
  /** 假设说明标题——与数字同屏，不可折叠 */
  assumptionTitle: string;
  changed: string;
  newlyApproved: string;
  newlyRejected: string;
  positiveRate: string;
  valueDelta: string;
  /** 金额无法估算时的占位文案（**不是** 0） */
  valueUnavailable: string;
  confidenceLabel: string;
  valueConfidenceLabel: string;
  confidenceInsufficient: string;
  confidenceLow: string;
  confidenceModerate: string;
  coverageNote: string;
  /** 两版本无可对齐执行时的兜底说明（route 通常会给更具体的 message） */
  notComparable: string;
  caveatsTitle: string;
  /** caveat 码 → 人类可读说明 */
  caveat: Record<string, string>;
}

type WhatIfResponse = Partial<WhatIfEstimate> & {
  policyId: string;
  baseVersion: number;
  targetVersion: number;
  comparedAgainst: number;
  /** false = 两版本无可对齐执行，此时不给任何数字（见 route 注释） */
  comparable?: boolean;
  reason?: string;
  message?: string;
  alignedCount?: number;
  limit: number;
};

/**
 * What-if 影响估算面板（Phase 4）。
 *
 * <p><b>★这个面板的首要职责是防止数字被误读，其次才是展示数字。</b>
 *
 * <p>估算建立在「决策相同 ⇒ 业务结果同分布」这一假设上（见 whatif-estimate.ts
 * 头注释）。因此本组件强制三件事，都不做成可关闭/可折叠：
 * <ul>
 *   <li>assumption 原文与数字同屏</li>
 *   <li>两档置信度分别标注——正面率与金额的样本量可能差很远</li>
 *   <li>金额无基线时显示"无法估算"而**不是** 0（"没数据"≠"没变化"）</li>
 * </ul>
 *
 * <p>对银行/风控客户，把有前提的推断包装成承诺是危险的；宁可界面啰嗦。
 */
export function WhatIfPanel({
  policyId,
  baseVersion,
  targetVersion,
  positiveOutcomes,
  negativeOutcomes,
  labels,
}: {
  policyId: string;
  baseVersion: number;
  targetVersion: number;
  positiveOutcomes?: readonly string[];
  negativeOutcomes?: readonly string[];
  labels: Labels;
}) {
  const [data, setData] = useState<WhatIfResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    const qs = new URLSearchParams({
      baseVersion: String(baseVersion),
      targetVersion: String(targetVersion),
    });
    if (positiveOutcomes?.length) qs.set('positiveOutcomes', positiveOutcomes.join(','));
    if (negativeOutcomes?.length) qs.set('negativeOutcomes', negativeOutcomes.join(','));

    fetch(`/api/policies/${policyId}/whatif?${qs.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json: WhatIfResponse) => {
        if (cancelled) return;
        setData(json);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
    // positiveOutcomes/negativeOutcomes 是数组，join 成字符串做依赖以免每次渲染都重取
  }, [
    policyId,
    baseVersion,
    targetVersion,
    positiveOutcomes?.join(','),
    negativeOutcomes?.join(','),
  ]);

  if (state === 'loading') {
    return <p className="text-sm text-fg-muted">{labels.loading}</p>;
  }
  if (state === 'error') {
    return (
      <Alert variant="danger">
        <AlertDescription>{labels.loadFailed}</AlertDescription>
      </Alert>
    );
  }
  // ★不可比时明确说明，绝不渲染一串 0 —— 那会被读成「改版本毫无影响」。
  if (data && data.comparable === false) {
    return (
      <Stack gap={2}>
        <h3 className="text-sm font-medium text-fg">{labels.title}</h3>
        <Alert variant="warning">
          <AlertDescription>{data.message ?? labels.notComparable}</AlertDescription>
        </Alert>
      </Stack>
    );
  }
  if (!data || !data.withOutcome) {
    return (
      <Stack gap={2}>
        <p className="text-sm text-fg-muted">{labels.empty}</p>
        {/* 没有回传结局就没有估算——讲清楚原因，否则用户以为功能坏了 */}
        <p className="text-xs text-fg-subtle">{labels.emptyHint}</p>
      </Stack>
    );
  }

  const confText = (c: Confidence) =>
    c === 'moderate'
      ? labels.confidenceModerate
      : c === 'low'
        ? labels.confidenceLow
        : labels.confidenceInsufficient;

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <h3 className="text-sm font-medium text-fg">{labels.title}</h3>
        <p className="text-sm text-fg-muted">{labels.subtitle}</p>
      </Stack>

      {/* ★假设说明：常驻、不可关闭。数字离开它就会被当成承诺。 */}
      <Alert>
        <AlertDescription>
          <span className="font-medium">{labels.assumptionTitle}</span> {data.assumption ?? ''}
        </AlertDescription>
      </Alert>

      <Card>
        <CardBody className="pt-4">
          <Stack gap={3}>
            <Metric label={labels.changed} value={String(data.changed ?? 0)} />
            <Metric label={labels.newlyApproved} value={`+${data.newlyApproved ?? 0}`} />
            <Metric label={labels.newlyRejected} value={`-${data.newlyRejected ?? 0}`} />
            <Metric
              label={labels.positiveRate}
              value={
                data.baselinePositiveRate === null || data.baselinePositiveRate === undefined
                  ? '—'
                  : `${Math.round(data.baselinePositiveRate * 100)}%`
              }
              // 正面率的置信度
              hint={`${labels.confidenceLabel}: ${confText(data.confidence ?? 'insufficient')}`}
            />
            <Metric
              label={labels.valueDelta}
              // ★null 显示"无法估算"，绝不显示 0：两者结论完全不同
              value={
                data.estimatedValueDelta === null || data.estimatedValueDelta === undefined
                  ? labels.valueUnavailable
                  : formatDelta(data.estimatedValueDelta)
              }
              // ★金额单独一档置信度，不与正面率共用
              hint={`${labels.valueConfidenceLabel}: ${confText(data.valueConfidence ?? 'insufficient')}`}
              muted={data.estimatedValueDelta == null}
            />
          </Stack>
        </CardBody>
      </Card>

      {/* 目标版本样本远少于基线时 changed 会被系统性低估——必须说明 */}
      {data.sampleSize !== undefined && data.comparedAgainst < data.sampleSize && (
        <Alert>
          <AlertDescription>
            {labels.coverageNote
              .replace('{compared}', String(data.comparedAgainst))
              .replace('{total}', String(data.sampleSize))}
          </AlertDescription>
        </Alert>
      )}

      {(data.caveats?.length ?? 0) > 0 && (
        <Card className="border-amber-200">
          <CardBody className="pt-4">
            <Stack gap={2}>
              <h4 className="text-sm font-medium text-fg">{labels.caveatsTitle}</h4>
              <ul className="space-y-1">
                {(data.caveats ?? []).map((c) => (
                  <li key={c} className="text-sm text-fg-muted">
                    {/* 未知码兜底显示原码，不静默吞掉 */}
                    {labels.caveat[c] ?? c}
                  </li>
                ))}
              </ul>
            </Stack>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}

/** 带符号的金额变化——正负号是这个数字最重要的信息，不能靠颜色单独承载。 */
function formatDelta(v: number): string {
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function Metric({
  label,
  value,
  hint,
  muted,
}: {
  label: string;
  value: string;
  hint?: string;
  muted?: boolean;
}) {
  return (
    <Stack direction="row" justify="between" align="center" gap={3}>
      <Stack gap={0}>
        <span className="text-sm text-fg">{label}</span>
        {hint && <span className="text-xs text-fg-subtle">{hint}</span>}
      </Stack>
      <span
        className={
          muted ? 'shrink-0 text-sm text-fg-subtle' : 'shrink-0 text-sm font-medium text-fg'
        }
      >
        {value}
      </span>
    </Stack>
  );
}
