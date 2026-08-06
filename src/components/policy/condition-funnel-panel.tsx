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
  /** ★标题必须表达「样本内未命中」而非「死分支」——见下方渲染处注释 */
  neverMatchedTitle: string;
  neverMatchedHint: string;
  /** 截断提示：本次只看了最近 N 条 */
  truncatedNote: string;
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
          {/* ★截断必须说：不说的话，「这条件从未命中」会被读成结论，
              而实际可能只是它没赶上最近这批样本。 */}
          {data.truncated === true && (
            <>
              {' '}
              {labels.truncatedNote
                .replace('{scanned}', String(data.scanned))
                .replace('{total}', String(data.total ?? '?'))}
            </>
          )}
        </AlertDescription>
      </Alert>

      <Card>
        <CardBody className="pt-4">
          <Stack gap={3}>
            {data.steps.map((s) => (
              <FunnelRow
                key={`${s.stepId}|${s.expression}`}
                step={s}
                max={maxEvaluated}
                labels={labels}
              />
            ))}
          </Stack>
        </CardBody>
      </Card>

      {/* ★这里刻意**不**说"死分支"。本面板只看最近 N 条执行，样本内没命中
          不代表分支是死的——一个季度触发一次的风控规则在最近 500 条里当然
          一次都不命中，但它完全正常。说成"死分支"会诱导业务人员删掉有用的规则。
          真正的可达性判定由 Phase 2 的静态分析负责，不需要执行数据。 */}
      {data.neverMatchedInSample.length > 0 && (
        <Card className="border-amber-200">
          <CardBody className="pt-4">
            <Stack gap={2}>
              <h4 className="text-sm font-medium text-fg">{labels.neverMatchedTitle}</h4>
              <p className="text-sm text-fg-muted">{labels.neverMatchedHint}</p>
              <ul className="space-y-1">
                {data.neverMatchedInSample.map((s) => (
                  <li key={`${s.stepId}|${s.expression}`} className="text-sm text-fg">
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
