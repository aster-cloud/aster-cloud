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
  notComparable: string;
  /** 未开启授权开关时的兜底文案（后端通常会给更具体的 message） */
  notAuthorized: string;
  caveatsTitle: string;
  caveat: Record<string, string>;
}

/** 每次响应都带的口径字段（ADR 0033 §3.3）。 */
interface Counts {
  sampleSize: number;
  replayable: number;
  replayed: number;
  replayFailed: number;
  coverage: number;
  truncated: boolean;
  limit: number;
}

/**
 * ★严格判别联合，不是 `Partial<WhatIfEstimate>`。
 *
 * <p>上一版面板用 `Partial<>` + 一堆 `?? 0` 兜底，结果「字段缺失」会被渲染成
 * 看似正常的 0——与「拒绝给数字」的初衷完全相反（第四/五轮交叉审查指出）。
 * 判别联合让 TypeScript 强制：只有 `comparable === true` 的分支才拿得到数字，
 * 编译期就堵死了兜底 0 的写法。
 */
type WhatIfResponse =
  | ({
      policyId: string;
      baseVersion: number;
      targetVersion: number;
      comparable: false;
      reason: 'INSUFFICIENT_REPLAYED' | 'INSUFFICIENT_COVERAGE';
      message: string;
    } & Counts)
  | ({
      policyId: string;
      baseVersion: number;
      targetVersion: number;
      comparable: true;
    } & Counts &
      WhatIfEstimate);

/**
 * What-if 影响估算面板（Phase 4，ADR 0033 接回后）。
 *
 * <p><b>★首要职责是防止数字被误读，其次才是展示数字。</b>
 *
 * <p>估算建立在「决策相同 ⇒ 业务结果同分布」这一假设上（见 whatif-estimate.ts
 * 头注释）。故强制四件事，都不做成可关闭/可折叠：
 * <ul>
 *   <li>assumption 原文与数字同屏</li>
 *   <li>两档置信度分别标注——正面率与金额的样本量可能差很远</li>
 *   <li>金额无基线时显示「无法估算」而**不是** 0</li>
 *   <li>口径（重跑了多少条 / 占多大比例）常驻可见</li>
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
  const [state, setState] = useState<'loading' | 'ok' | 'error' | 'denied'>('loading');
  const [deniedMessage, setDeniedMessage] = useState('');

  // 数组依赖 join 成字符串，避免每次渲染都重取
  const positiveKey = positiveOutcomes?.join(',') ?? '';
  const negativeKey = negativeOutcomes?.join(',') ?? '';

  // ★loading 态由 key 变化驱动而非在 effect 里 setState：
  //   参数变了就用新 key 重挂组件，React 自然拿到初始 loading 态。
  //   （直接在 effect 里 setState 会触发 react-hooks/set-state-in-effect）
  useEffect(() => {
    let cancelled = false;
    const qs = new URLSearchParams({
      baseVersion: String(baseVersion),
      targetVersion: String(targetVersion),
    });
    if (positiveKey) qs.set('positiveOutcomes', positiveKey);
    if (negativeKey) qs.set('negativeOutcomes', negativeKey);

    fetch(`/api/policies/${policyId}/whatif?${qs.toString()}`)
      .then(async (r) => {
        if (r.ok) return { kind: 'ok' as const, json: (await r.json()) as WhatIfResponse };
        // ★403 要把后端的「如何开启」说明透出来，不能笼统显示「加载失败」。
        //   这个能力默认关闭且需显式授权，用户看到通用报错只会以为功能坏了
        //   （第八轮 P0-8）。其余状态码仍走通用失败。
        if (r.status === 403) {
          const body = (await r.json().catch(() => null)) as
            | { error?: { message?: string } }
            | null;
          return { kind: 'denied' as const, message: body?.error?.message ?? '' };
        }
        throw new Error(String(r.status));
      })
      .then((res) => {
        if (cancelled) return;
        if (res.kind === 'denied') {
          setDeniedMessage(res.message);
          setState('denied');
          return;
        }
        setData(res.json);
        setState('ok');
      })
      .catch(() => {
        if (!cancelled) setState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [policyId, baseVersion, targetVersion, positiveKey, negativeKey]);

  if (state === 'loading') {
    return <p className="text-sm text-fg-muted">{labels.loading}</p>;
  }
  // ★未授权：显示后端给的「如何开启」说明，而不是通用「加载失败」
  if (state === 'denied') {
    return (
      <Stack gap={2}>
        <h3 className="text-sm font-medium text-fg">{labels.title}</h3>
        <Alert variant="warning">
          <AlertDescription>{deniedMessage || labels.notAuthorized}</AlertDescription>
        </Alert>
      </Stack>
    );
  }
  if (state === 'error') {
    return (
      <Alert variant="danger">
        <AlertDescription>{labels.loadFailed}</AlertDescription>
      </Alert>
    );
  }
  if (!data) {
    return (
      <Stack gap={2}>
        <p className="text-sm text-fg-muted">{labels.empty}</p>
        <p className="text-xs text-fg-subtle">{labels.emptyHint}</p>
      </Stack>
    );
  }

  // ★不可比时给原因，绝不渲染一串 0 —— 那会被读成「改版本毫无影响」。
  //   同时把口径亮出来：用户要据此判断是「再攒些数据」还是「大多不可回放」。
  if (!data.comparable) {
    return (
      <Stack gap={3}>
        <h3 className="text-sm font-medium text-fg">{labels.title}</h3>
        <Alert variant="warning">
          <AlertDescription>{data.message || labels.notComparable}</AlertDescription>
        </Alert>
        <CoverageNote data={data} labels={labels} />
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
          <span className="font-medium">{labels.assumptionTitle}</span> {data.assumption}
        </AlertDescription>
      </Alert>

      <Card>
        <CardBody className="pt-4">
          <Stack gap={3}>
            <Metric label={labels.changed} value={String(data.changed)} />
            <Metric label={labels.newlyApproved} value={`+${data.newlyApproved}`} />
            <Metric label={labels.newlyRejected} value={`-${data.newlyRejected}`} />
            <Metric
              label={labels.positiveRate}
              value={
                data.baselinePositiveRate === null
                  ? '—'
                  : `${Math.round(data.baselinePositiveRate * 100)}%`
              }
              hint={`${labels.confidenceLabel}: ${confText(data.confidence)}`}
            />
            <Metric
              label={labels.valueDelta}
              // ★null 显示「无法估算」，绝不显示 0：两者结论完全不同
              value={
                data.estimatedValueDelta === null
                  ? labels.valueUnavailable
                  : formatDelta(data.estimatedValueDelta)
              }
              // ★金额单独一档置信度，不与正面率共用
              hint={`${labels.valueConfidenceLabel}: ${confText(data.valueConfidence)}`}
              muted={data.estimatedValueDelta === null}
            />
          </Stack>
        </CardBody>
      </Card>

      <CoverageNote data={data} labels={labels} />

      {data.caveats.length > 0 && (
        <Card className="border-amber-200">
          <CardBody className="pt-4">
            <Stack gap={2}>
              <h4 className="text-sm font-medium text-fg">{labels.caveatsTitle}</h4>
              <ul className="space-y-1">
                {data.caveats.map((c) => (
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

/**
 * 口径说明：常驻，不可关闭。
 *
 * <p>与 Phase 1 漏斗的 sampleNote 同理——不标注地展示会让人以为是全量分析。
 * 这里的分母比漏斗更窄：只有 REPLAYABLE 且重跑成功的执行才进估算。
 */
function CoverageNote({ data, labels }: { data: Counts; labels: Labels }) {
  return (
    <Alert>
      <AlertDescription>
        {labels.coverageNote
          .replace('{replayed}', String(data.replayed))
          .replace('{total}', String(data.sampleSize))
          .replace('{percent}', String(Math.round(data.coverage * 100)))}
        {data.replayFailed > 0 && ` (${data.replayFailed} failed)`}
        {data.truncated && ` · ${data.limit}+`}
      </AlertDescription>
    </Alert>
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
