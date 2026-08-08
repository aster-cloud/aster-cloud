'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AlertDescription, Button, Card, CardBody, Stack } from '@/components/ui';

/**
 * What-If 影响估算面板（ADR 0034 S4）。
 *
 * <p><b>三条硬约束，都直接来自 §1.1</b>：
 * <ol>
 *   <li><b>窗口口径必须与数字同屏</b>——用户要知道自己看的是哪个总体。
 *       「最近一个月全部 N 条」与「从 200 条里挑出成功的 30 条」是本质不同的东西。</li>
 *   <li><b>拒答不显示任何业务数字</b>——连「已成功 N 条」都不给。
 *       给了用户就会自己算成功率，那正是上一版 Phase 4 的死因。</li>
 *   <li><b>进度只显示已处理数</b>——不显示成功数，否则用户会在批次跑完前
 *       自行推断结论。</li>
 * </ol>
 *
 * <p>★文案当前为英文硬编码：Phase 4 时期的四语文案只存在于已关闭的分支，
 * `@aster-cloud/ui-messages` 包里零命中。补文案要走跨仓发版链
 * （改 ui-messages → 发版 → cloud bump），作为独立工作项推进。
 * 先英文上线是为了让交互与拒答呈现能被真实点击验证。
 */

type BatchStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'EXPIRED';

interface BatchState {
  batchId: string;
  status: BatchStatus;
  windowLabel: string;
  windowFrom: string;
  windowTo: string;
  plannedCount: number;
  /** 仅 PENDING/RUNNING：已处理条数（成功+失败），★不含成功数 */
  processedCount?: number;
  /** 仅 COMPLETED */
  result?: {
    changed: number;
    newlyApproved: number;
    newlyRejected: number;
    totalSampled: number;
    estimatedValueDelta: number | null;
  };
  /** 仅 FAILED：失败原因分布 */
  failureReasons?: Record<string, number>;
  rejected?: boolean;
  expired?: boolean;
}

const WINDOW_PRESETS = [
  { kind: 'LAST_MONTH', label: 'Last month' },
  { kind: 'LAST_QUARTER', label: 'Last quarter' },
  { kind: 'LAST_HALF_YEAR', label: 'Last 6 months' },
  { kind: 'LAST_YEAR', label: 'Last year' },
  { kind: 'CUSTOM', label: 'Custom range' },
] as const;

/** 失败分类的人类可读说明——★区分「你的数据」与「服务端繁忙」。 */
const FAILURE_HINTS: Record<string, string> = {
  TARGET_COMPILE_ERROR: 'The target version failed to compile. Retrying will not help.',
  INPUT_INCOMPATIBLE: 'Historical inputs are incompatible with the target version.',
  VOCABULARY_UNAVAILABLE: 'A vocabulary or alias snapshot is missing.',
  TIMEOUT: 'Evaluation timed out. You can retry.',
  THROTTLED: 'The server was busy. This is not a problem with your data — you can retry.',
  UNKNOWN: 'Unclassified failure.',
};

/** 今天（用户本地时区）的 YYYY-MM-DD，用作自定义窗口的上限。 */
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function WhatIfBatchPanel({
  policyId,
  baseVersionId,
  targetVersionId,
  /** 租户是否拥有 What-If 权益。false → 入口可见但禁用 + 升级引导（§7.5）。 */
  entitled,
}: {
  policyId: string;
  baseVersionId: string;
  targetVersionId: string;
  entitled: boolean;
}) {
  const [windowKind, setWindowKind] = useState<string>('LAST_MONTH');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyBatchId, setBusyBatchId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isRunning = batch?.status === 'PENDING' || batch?.status === 'RUNNING';

  /**
   * 轮询间隔随规模自适应（§7.4）：小批次 1s，万条以上 5s，
   * 避免大批次时把查询端点打爆。
   */
  const pollInterval = (planned: number) => (planned >= 10_000 ? 5_000 : 1_000);

  const fetchBatch = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/v1/policies/${policyId}/whatif-batches/${id}`);
      if (!res.ok) {
        setError('Failed to load batch status.');
        return null;
      }
      const data = (await res.json()) as BatchState;
      setBatch(data);
      return data;
    },
    [policyId],
  );

  // 轮询：批次进行中时按规模自适应间隔拉取
  useEffect(() => {
    if (!batch || !isRunning) return;
    pollRef.current = setTimeout(() => {
      void fetchBatch(batch.batchId);
    }, pollInterval(batch.plannedCount));
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [batch, isRunning, fetchBatch]);

  const start = async () => {
    setError(null);
    setBusyBatchId(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/v1/policies/${policyId}/whatif-batches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseVersionId,
          targetVersionId,
          windowKind,
          customFrom: windowKind === 'CUSTOM' ? customFrom : undefined,
          customTo: windowKind === 'CUSTOM' ? customTo : undefined,
        }),
      });

      if (res.status === 403) {
        // 无权益——引导升级，不是「稍后再试」
        setError('What-If impact analysis requires a Pro plan or above.');
        return;
      }
      if (res.status === 409) {
        // 已有批次在跑——给出当前批次，让用户能看进度而不是干等
        const body = await res.json();
        setBusyBatchId(body.currentBatchId ?? null);
        setError('A batch is already running. You can start a new one once it finishes.');
        if (body.currentBatchId) void fetchBatch(body.currentBatchId);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? 'Failed to start the batch.');
        return;
      }
      setBatch((await res.json()) as BatchState);
    } finally {
      setStarting(false);
    }
  };

  // ── free 租户：入口可见但禁用 + 升级引导（§7.5）────────────────────
  if (!entitled) {
    return (
      <Card>
        <CardBody>
          <Stack gap={3}>
            <h3 className="text-base font-semibold">What-if impact analysis</h3>
            <p className="text-sm text-muted-foreground">
              See how switching to another policy version would have changed past decisions.
            </p>
            <Alert>
              <AlertDescription>
                {/* ★不给试用额度、不给样例数字——否则 §1.1 会在营销路径上被绕过 */}
                This feature requires a <strong>Pro</strong> plan or above.
              </AlertDescription>
            </Alert>
            <Button disabled>Run analysis</Button>
          </Stack>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardBody>
        <Stack gap={4}>
          <div>
            <h3 className="text-base font-semibold">What-if impact analysis</h3>
            <p className="text-sm text-muted-foreground">
              Replays every re-runnable execution in the selected window against the target
              version. Results are shown only if <strong>all</strong> replays succeed.
            </p>
          </div>

          {/* ── 窗口选择 ─────────────────────────────────────────────── */}
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium">Time window</span>
              <select
                className="rounded border px-2 py-1"
                value={windowKind}
                onChange={(e) => setWindowKind(e.target.value)}
                disabled={isRunning || starting}
              >
                {WINDOW_PRESETS.map((p) => (
                  <option key={p.kind} value={p.kind}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>

            {windowKind === 'CUSTOM' && (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">From</span>
                  <input
                    type="date"
                    className="rounded border px-2 py-1"
                    value={customFrom}
                    max={todayISO()}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    disabled={isRunning || starting}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="font-medium">To</span>
                  <input
                    type="date"
                    className="rounded border px-2 py-1"
                    value={customTo}
                    /* ★前端 max 只是体验；服务端独立拒绝未来日期（§7.1） */
                    max={todayISO()}
                    onChange={(e) => setCustomTo(e.target.value)}
                    disabled={isRunning || starting}
                  />
                </label>
              </>
            )}

            <Button onClick={() => void start()} disabled={isRunning || starting}>
              {starting ? 'Starting…' : 'Run analysis'}
            </Button>
          </div>

          {error && (
            <Alert>
              <AlertDescription>
                {error}
                {busyBatchId && (
                  <span className="ml-1 text-muted-foreground">
                    (batch {busyBatchId.slice(0, 8)})
                  </span>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* ── 进行中：只显示已处理数，★不显示成功数（§7.4）────────── */}
          {batch && isRunning && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>
                  Replaying <strong>{batch.windowLabel}</strong>
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {batch.processedCount ?? 0} / {batch.plannedCount}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded bg-muted">
                <div
                  className="h-full bg-primary transition-[width]"
                  style={{
                    width: `${
                      batch.plannedCount > 0
                        ? Math.min(100, ((batch.processedCount ?? 0) / batch.plannedCount) * 100)
                        : 0
                    }%`,
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Results appear only after every execution has been replayed successfully.
              </p>
            </div>
          )}

          {/* ── 完成：数字必须与窗口口径同屏（§1.1）──────────────────── */}
          {batch?.status === 'COMPLETED' && batch.result && (
            <div className="space-y-3">
              <p className="text-sm">
                Based on <strong>all {batch.result.totalSampled}</strong> re-runnable executions in{' '}
                <strong>{batch.windowLabel}</strong>.
              </p>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Metric label="Decisions changed" value={batch.result.changed} />
                <Metric label="Newly approved" value={batch.result.newlyApproved} />
                <Metric label="Newly rejected" value={batch.result.newlyRejected} />
              </div>
              <p className="text-sm">
                Estimated value impact:{' '}
                {batch.result.estimatedValueDelta === null ? (
                  // ★「无法估算」≠「估算为零」——不得渲染成 0
                  <span className="text-muted-foreground">
                    not available (no monetary baseline)
                  </span>
                ) : (
                  <strong className="tabular-nums">{batch.result.estimatedValueDelta}</strong>
                )}
              </p>
            </div>
          )}

          {/* ── 拒答：★零业务数字，只给失败原因（§1.1）──────────────── */}
          {batch?.status === 'FAILED' && (
            <Alert>
              <AlertDescription>
                <Stack gap={2}>
                  <span>
                    No results for <strong>{batch.windowLabel}</strong>. Some executions could not
                    be replayed, so any numbers derived from the rest would not represent the full
                    population.
                  </span>
                  {batch.failureReasons && (
                    <ul className="list-disc pl-5 text-sm">
                      {Object.entries(batch.failureReasons).map(([kind, count]) => (
                        <li key={kind}>
                          <strong>{count}</strong> — {FAILURE_HINTS[kind] ?? kind}
                        </li>
                      ))}
                    </ul>
                  )}
                </Stack>
              </AlertDescription>
            </Alert>
          )}

          {batch?.status === 'EXPIRED' && (
            <Alert>
              <AlertDescription>
                This batch has expired. Results are kept for 30 days; run a new analysis to get
                current numbers.
              </AlertDescription>
            </Alert>
          )}
        </Stack>
      </CardBody>
    </Card>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
