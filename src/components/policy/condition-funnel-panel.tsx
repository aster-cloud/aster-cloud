'use client';

import { useEffect, useState } from 'react';
import { Alert, AlertDescription, Card, CardBody, Stack, cn } from '@/components/ui';
import type { ConditionFunnel, FunnelStep } from '@/lib/analytics/condition-funnel';

interface Labels {
  title: string;
  subtitle: string;
  loading: string;
  empty: string;
  emptyHint: string;
  sampleNote: string;
  coverageNote: string;
  deadTitle: string;
  deadHint: string;
  evaluated: string;
  matched: string;
  loadFailed: string;
}

/**
 * 条件漏斗面板（Phase 1）。
 *
 * <p><b>刻意用业务语言呈现</b>：只显示条件原文与命中数/占比，不出现
 * trace 树 / AST / stepId。目标读者是产品、运营、风控——他们要回答的是
 * "这条规则实际影响了多少笔"，不是"执行引擎走了哪些节点"。
 *
 * <p><b>★口径必须常驻</b>：分母是"平台记录到的执行"，不是客户全量业务数据。
 * 不标注地展示会让人误以为是全量分析——在风控场景下这是危险误导。
 * 故 sampleNote 与 coverage 提示都不做成可关闭的 toast。
 */
export function ConditionFunnelPanel({
  policyId,
  version,
  labels,
}: {
  policyId: string;
  version?: number;
  labels: Labels;
}) {
  const [data, setData] = useState<(ConditionFunnel & { coverage: number | null }) | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');

  useEffect(() => {
    let cancelled = false;
    const qs = version ? `?version=${version}` : '';
    fetch(`/api/policies/${policyId}/funnel${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((json) => {
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
  }, [policyId, version]);

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
  if (!data || data.withSkeleton === 0) {
    return (
      <Stack gap={2}>
        <p className="text-sm text-fg-muted">{labels.empty}</p>
        {/* 为什么没数据要讲清楚——否则用户以为功能坏了 */}
        <p className="text-xs text-fg-subtle">{labels.emptyHint}</p>
      </Stack>
    );
  }

  // 漏斗的视觉基准取最大求值数，让层级递减一眼可见
  const maxEvaluated = Math.max(...data.steps.map((s) => s.evaluated), 1);

  return (
    <Stack gap={4}>
      <Stack gap={1}>
        <h3 className="text-sm font-medium text-fg">{labels.title}</h3>
        <p className="text-sm text-fg-muted">{labels.subtitle}</p>
      </Stack>

      {/* ★口径说明：常驻，不可关闭 */}
      <Alert>
        <AlertDescription>
          {labels.sampleNote.replace('{count}', String(data.withSkeleton))}
          {data.coverage !== null && data.coverage < 1 && (
            <>
              {' '}
              {labels.coverageNote
                .replace('{covered}', String(data.withSkeleton))
                .replace('{total}', String(data.sampleSize))}
            </>
          )}
        </AlertDescription>
      </Alert>

      <Card>
        <CardBody className="pt-4">
          <Stack gap={3}>
            {data.steps.map((s) => (
              <FunnelRow key={s.stepId} step={s} max={maxEvaluated} labels={labels} />
            ))}
          </Stack>
        </CardBody>
      </Card>

      {/* 死分支单独强调——这是对业务人员最直观的价值：你写的条件从未生效 */}
      {data.deadBranches.length > 0 && (
        <Card className="border-amber-200">
          <CardBody className="pt-4">
            <Stack gap={2}>
              <h4 className="text-sm font-medium text-fg">{labels.deadTitle}</h4>
              <p className="text-sm text-fg-muted">{labels.deadHint}</p>
              <ul className="space-y-1">
                {data.deadBranches.map((s) => (
                  <li key={s.stepId} className="text-sm text-fg">
                    <span className="font-mono text-xs text-fg-muted">{s.evaluated}×</span>{' '}
                    {s.expression}
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

function FunnelRow({
  step,
  max,
  labels,
}: {
  step: FunnelStep;
  max: number;
  labels: Labels;
}) {
  const widthPct = Math.round((step.evaluated / max) * 100);
  const rate = step.matchRate === null ? null : Math.round(step.matchRate * 100);
  return (
    // depth 缩进还原嵌套层级，让"哪些条件是子条件"一眼可见
    <div style={{ paddingLeft: `${Math.min(step.depth, 4) * 12}px` }}>
      <Stack direction="row" justify="between" align="center" gap={3}>
        <span className="truncate text-sm text-fg">{step.expression}</span>
        <span className="shrink-0 text-xs text-fg-muted">
          {step.matched} / {step.evaluated}
          {rate !== null && <span className="ml-1">({rate}%)</span>}
        </span>
      </Stack>
      {/* 纯 CSS 条形图：不引图表库（体积 + CSP 友好，与 equivalence 趋势图同思路） */}
      <div className="mt-1 h-1.5 w-full rounded bg-bg-muted" aria-hidden>
        <div
          className={cn('h-1.5 rounded', step.matched === 0 ? 'bg-amber-400' : 'bg-primary')}
          style={{ width: `${widthPct}%` }}
        />
      </div>
      <span className="sr-only">
        {labels.evaluated}: {step.evaluated}, {labels.matched}: {step.matched}
      </span>
    </div>
  );
}
