/**
 * Parity trend chart — a hand-rolled SVG grouped bar chart for the dual-engine
 * equivalence dashboard.
 *
 * Why bars (not lines): both metrics (parse-acceptance parity and runtime eval
 * parity) sit near 100%, so two lines would overlap at the top and be hard to
 * tell apart. Grouped bars place the two series side by side per day — even
 * near-identical values stay visually distinct.
 *
 * Why no chart library: this is a server-rendered marketing/trust page on
 * Cloudflare Workers under a strict-dynamic CSP. A 100KB+ chart lib (recharts/
 * visx) would bloat the bundle and risk inline-style/eval CSP friction. The
 * trend is a handful of points — a bespoke SVG is lighter, fully themeable,
 * and renders identically server- and client-side.
 *
 * Features: adjustable time range (week / month / year / all), a magnified
 * y-axis that focuses on the actual value band (the way a market chart zooms
 * into the relevant range), a legend, hover tooltip on the nearest bar, and a
 * progressively-disclosed detail table. A series with no data for a given day
 * simply omits its bar there.
 */
'use client';

import { useId, useMemo, useState } from 'react';

export type TrendPoint = {
  /** ISO timestamp */
  timestamp: string;
  /** 0..1 rate */
  rate: number;
  /** numerator (accepted / identical) */
  value: number;
  /** denominator (total) */
  total: number;
};

export type SeriesAccent = 'violet' | 'emerald' | 'sky' | 'amber' | 'rose';

export type TrendSeries = {
  key: string;
  label: string;
  accent: SeriesAccent;
  points: TrendPoint[];
  /** Unused for bars; kept for API compatibility with the page. */
  area?: boolean;
};

type RangeKey = 'week' | 'month' | 'year' | 'all';

const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export type ParityTrendLabels = {
  heading: string;
  ranges: Record<RangeKey, string>;
  tooltipRatio: string; // "%value% / %total% …"
  delta: string; // "Δ"
  detailsToggle: string;
  colDate: string;
  colRatio: string;
  colRate: string;
  empty: string;
};

type Props = {
  series: TrendSeries[];
  labels: ParityTrendLabels;
  locale: string;
};

const PAD = { top: 18, right: 16, bottom: 30, left: 44 };
const VIEW_W = 720;
const VIEW_H = 280;

const ACCENTS: Record<SeriesAccent, { fill: string; text: string; dot: string }> = {
  violet: {
    fill: 'var(--aster-primary, #7c3aed)',
    text: 'text-[var(--aster-primary,#7c3aed)]',
    dot: 'bg-[var(--aster-primary,#7c3aed)]',
  },
  emerald: {
    fill: 'var(--aster-success, #059669)',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
  },
  sky: {
    fill: '#0284c7',
    text: 'text-sky-600 dark:text-sky-400',
    dot: 'bg-sky-600 dark:bg-sky-400',
  },
  amber: {
    fill: '#d97706',
    text: 'text-amber-600 dark:text-amber-400',
    dot: 'bg-amber-600 dark:bg-amber-400',
  },
  rose: {
    fill: '#e11d48',
    text: 'text-rose-600 dark:text-rose-400',
    dot: 'bg-rose-600 dark:bg-rose-400',
  },
};

function fmtPercent(rate: number, locale: string, digits = 1): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(rate);
}

function fmtDate(iso: string, locale: string, opts: Intl.DateTimeFormatOptions): string {
  try {
    return new Intl.DateTimeFormat(locale, opts).format(new Date(iso));
  } catch {
    return iso;
  }
}

type Bar = {
  x: number;
  y: number;
  w: number;
  h: number;
  series: TrendSeries;
  point: TrendPoint;
};

export function ParityTrendChart({ series, labels, locale }: Props) {
  const clipId = useId();
  const [range, setRange] = useState<RangeKey>('all');
  const [hover, setHover] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const sortedSeries = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        points: [...s.points].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp)),
      })),
    [series],
  );

  const allTimes = useMemo(
    () => sortedSeries.flatMap((s) => s.points.map((p) => +new Date(p.timestamp))),
    [sortedSeries],
  );
  const newest = allTimes.length ? Math.max(...allTimes) : 0;
  const oldest = allTimes.length ? Math.min(...allTimes) : 0;

  const rangedSeries = useMemo(() => {
    if (range === 'all') return sortedSeries;
    const cutoff = newest - RANGE_DAYS[range] * 86_400_000;
    return sortedSeries.map((s) => ({
      ...s,
      points: s.points.filter((p) => +new Date(p.timestamp) >= cutoff),
    }));
  }, [sortedSeries, range, newest]);

  const { bars, ticks, days, activeSeries } = useMemo(() => {
    // Categories = the union of all days present in any series, sorted.
    const dayKeys = Array.from(
      new Set(rangedSeries.flatMap((s) => s.points.map((p) => p.timestamp.slice(0, 10)))),
    ).sort();

    // The series that actually have at least one point in range, in order.
    const liveSeries = rangedSeries.filter((s) => s.points.length > 0);

    const rates = rangedSeries.flatMap((s) => s.points.map((p) => p.rate));
    if (rates.length === 0 || dayKeys.length === 0) {
      return { bars: [] as Bar[], ticks: [] as { v: number; y: number }[], days: [] as string[], activeSeries: liveSeries };
    }
    const lo = Math.min(...rates);
    const hi = Math.max(...rates);
    const yHi = Math.min(1, Math.ceil((hi + 0.001) * 20) / 20);
    // Magnified y-axis (zooms into the high band so a 92.9%→100% climb is
    // legible) BUT with a floor buffer: the lowest value must not sit flush at
    // the bottom, or a real-but-lower bar (e.g. feature coverage 90.7% next to
    // four 100% bars) reads as ~zero. Pick yLo so the lowest bar fills ≥35% of
    // the axis: from (lo - yLo)/(yHi - yLo) ≥ 0.35 → yLo ≤ (lo - 0.35·yHi)/0.65.
    // Snap down to a 5% tick and clamp to [0, lo).
    const yLoTarget = (lo - 0.35 * yHi) / 0.65;
    const yLo = Math.max(0, Math.min(Math.floor((lo - 0.001) * 20) / 20, Math.floor(yLoTarget * 20) / 20));
    const span = Math.max(yHi - yLo, 0.05);

    const innerW = VIEW_W - PAD.left - PAD.right;
    const innerH = VIEW_H - PAD.top - PAD.bottom;
    const baseY = PAD.top + innerH;
    const yOf = (r: number) => PAD.top + (1 - (r - yLo) / span) * innerH;

    // Group geometry: each day is a slot; bars for live series sit side by side.
    const slotW = innerW / dayKeys.length;
    const groupPad = Math.min(slotW * 0.22, 14); // gap between day groups
    const groupW = slotW - groupPad;
    const n = Math.max(liveSeries.length, 1);
    const barGap = n > 1 ? Math.min(groupW * 0.12, 6) : 0;
    const barW = (groupW - barGap * (n - 1)) / n;

    const out: Bar[] = [];
    dayKeys.forEach((day, di) => {
      const slotX = PAD.left + di * slotW + groupPad / 2;
      liveSeries.forEach((s, si) => {
        const p = s.points.find((pt) => pt.timestamp.slice(0, 10) === day);
        if (!p) return;
        const x = slotX + si * (barW + barGap);
        const y = yOf(p.rate);
        out.push({ x, y, w: barW, h: Math.max(baseY - y, 1), series: s, point: p });
      });
    });

    const tickVals = Array.from({ length: 4 }, (_, i) => yLo + (span * i) / 3);
    const tk = tickVals.map((v) => ({ v, y: yOf(v) }));
    return { bars: out, ticks: tk, days: dayKeys, activeSeries: liveSeries };
  }, [rangedSeries]);

  const hasAny = sortedSeries.some((s) => s.points.length > 0);
  if (!hasAny) {
    return (
      <section className="mb-12">
        <h2 className="mb-4 text-xl font-semibold">{labels.heading}</h2>
        <p className="rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-400">
          {labels.empty}
        </p>
      </section>
    );
  }

  const availableRanges = (['week', 'month', 'year', 'all'] as RangeKey[]).filter((r) => {
    if (r === 'all') return true;
    return newest - oldest >= RANGE_DAYS[r] * 86_400_000 * 0.5;
  });
  const ranges = availableRanges.length >= 2 ? availableRanges : (['all'] as RangeKey[]);

  const active = hover != null ? bars[hover] : undefined;
  // Primary series (first live one) drives the detail table.
  const primary = activeSeries[0];
  const primaryRows = primary ? [...primary.points].reverse() : [];

  // x labels: first + last day only, to avoid clutter.
  const labelDays = days.length <= 1 ? days : [days[0]!, days[days.length - 1]!];

  return (
    <section className="mb-12">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-xl font-semibold">{labels.heading}</h2>
        {ranges.length > 1 && (
          <div
            role="tablist"
            aria-label={labels.heading}
            className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-0.5 dark:border-gray-700 dark:bg-gray-900"
          >
            {ranges.map((r) => {
              const selected = r === range;
              return (
                <button
                  key={r}
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setRange(r);
                    setHover(null);
                  }}
                  className={
                    'rounded-md px-3 py-1 text-xs font-medium tabular-nums transition-colors ' +
                    (selected
                      ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                      : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200')
                  }
                >
                  {labels.ranges[r]}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* legend */}
      <div className="mb-3 flex flex-wrap gap-4">
        {activeSeries.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className={'inline-block h-2.5 w-2.5 rounded-[3px] ' + ACCENTS[s.accent].dot} aria-hidden />
            {s.label}
          </span>
        ))}
      </div>

      <div className="relative rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900 sm:p-5">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
          role="img"
          aria-label={labels.heading}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            if (bars.length === 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
            const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
            // nearest bar by horizontal center, tie-broken by vertical proximity
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < bars.length; i++) {
              const b = bars[i]!;
              const cx = b.x + b.w / 2;
              const dx = cx - x;
              const dy = Math.max(0, b.y - y, y - (b.y + b.h));
              const dist = dx * dx + dy * dy * 0.15;
              if (dist < bestDist) {
                bestDist = dist;
                best = i;
              }
            }
            setHover(best);
          }}
        >
          <defs>
            <clipPath id={clipId}>
              <rect x="0" y="0" width={VIEW_W} height={VIEW_H} rx="3" />
            </clipPath>
          </defs>

          {/* y gridlines + labels */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line
                x1={PAD.left}
                x2={VIEW_W - PAD.right}
                y1={t.y}
                y2={t.y}
                className="stroke-gray-100 dark:stroke-gray-800"
                strokeWidth="1"
              />
              <text
                x={PAD.left - 8}
                y={t.y + 3}
                textAnchor="end"
                className="fill-gray-400 font-mono text-[10px] dark:fill-gray-500"
              >
                {fmtPercent(t.v, locale, 0)}
              </text>
            </g>
          ))}

          {/* bars */}
          {bars.map((b, i) => {
            const isActive = active && active === b;
            return (
              <rect
                key={i}
                x={b.x}
                y={b.y}
                width={b.w}
                height={b.h}
                rx={Math.min(b.w / 2, 3)}
                fill={ACCENTS[b.series.accent].fill}
                className={
                  'origin-bottom transition-opacity ' +
                  (active && !isActive ? 'opacity-55' : 'opacity-100') +
                  ' motion-safe:[animation:parity-bar-grow_700ms_cubic-bezier(0.22,1,0.36,1)_backwards]'
                }
                style={{ animationDelay: `${Math.min(i * 40, 400)}ms`, transformBox: 'fill-box' }}
              />
            );
          })}

          {/* x labels: first + last day */}
          {labelDays.map((day) => {
            const dayBars = bars.filter((b) => b.point.timestamp.slice(0, 10) === day);
            if (dayBars.length === 0) return null;
            const cx = dayBars.reduce((s, b) => s + b.x + b.w / 2, 0) / dayBars.length;
            const isFirst = day === days[0];
            return (
              <text
                key={day}
                x={cx}
                y={VIEW_H - 9}
                textAnchor={days.length <= 1 ? 'middle' : isFirst ? 'start' : 'end'}
                className="fill-gray-400 font-mono text-[10px] dark:fill-gray-500"
              >
                {fmtDate(dayBars[0]!.point.timestamp, locale, { month: 'short', day: 'numeric' })}
              </text>
            );
          })}
        </svg>

        {/* tooltip */}
        {active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={{
              left: `${((active.x + active.w / 2) / VIEW_W) * 100}%`,
              top: `calc(${(active.y / VIEW_H) * 100}% - 10px)`,
            }}
          >
            <div className="flex items-center gap-1.5 font-semibold tabular-nums">
              <span className={'inline-block h-2 w-2 rounded-[3px] ' + ACCENTS[active.series.accent].dot} aria-hidden />
              {active.series.label}
            </div>
            <div className="mt-0.5 text-gray-600 tabular-nums dark:text-gray-300">
              {fmtDate(active.point.timestamp, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
            <div className={'mt-0.5 text-base font-bold tabular-nums ' + ACCENTS[active.series.accent].text}>
              {fmtPercent(active.point.rate, locale)}
            </div>
            <div className="mt-0.5 text-gray-500 tabular-nums dark:text-gray-400">
              {labels.tooltipRatio
                .replace('%value%', String(active.point.value))
                .replace('%total%', String(active.point.total))}
            </div>
          </div>
        )}
      </div>

      {/* progressively-disclosed detail table (primary series) */}
      {primary && primary.points.length > 1 && (
        <details
          className="mt-3"
          open={showDetails}
          onToggle={(e) => setShowDetails((e.currentTarget as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200">
            {labels.detailsToggle}
          </summary>
          <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-800">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    {labels.colDate}
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    {labels.colRatio}
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    {labels.colRate}
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    {labels.delta}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {primaryRows.map((p, i, arr) => {
                  const prev = arr[i + 1];
                  const delta = prev ? p.rate - prev.rate : null;
                  return (
                    <tr key={p.timestamp}>
                      <td className="px-4 py-2 text-sm tabular-nums">
                        {fmtDate(p.timestamp, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {p.value} / {p.total}
                      </td>
                      <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
                        {fmtPercent(p.rate, locale)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm tabular-nums">
                        {delta === null
                          ? '—'
                          : delta === 0
                          ? '0'
                          : (delta > 0 ? '+' : '') + (delta * 100).toFixed(2) + 'pp'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
