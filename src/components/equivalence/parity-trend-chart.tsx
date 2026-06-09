/**
 * Parity trend chart — a hand-rolled SVG line/area chart ("market ticker" feel)
 * for the dual-engine equivalence dashboard.
 *
 * Why no chart library: this is a server-rendered marketing/trust page on
 * Cloudflare Workers under a strict-dynamic CSP. A 100KB+ chart lib (recharts/
 * visx) would bloat the bundle and risk inline-style/eval CSP friction. The
 * trend is a handful of points — a bespoke SVG is lighter, fully themeable,
 * and renders identically server- and client-side.
 *
 * Features: adjustable time range (week / month / year / all), a magnified
 * y-axis that focuses on the actual value band (not 0–100, the way a market
 * index chart zooms into the relevant range), hover crosshair + tooltip with
 * Δ, and a progressively-disclosed detail table.
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

type RangeKey = 'week' | 'month' | 'year' | 'all';

const RANGE_DAYS: Record<Exclude<RangeKey, 'all'>, number> = {
  week: 7,
  month: 30,
  year: 365,
};

export type ParityTrendLabels = {
  heading: string;
  ranges: Record<RangeKey, string>;
  axisRate: string;
  axisDate: string;
  tooltipRatio: string; // "{value} / {total}"
  delta: string; // "Δ"
  detailsToggle: string;
  colDate: string;
  colRatio: string;
  colRate: string;
  empty: string;
};

type Props = {
  points: TrendPoint[];
  labels: ParityTrendLabels;
  locale: string;
  /** Tailwind stroke/fill accent. Defaults to the brand violet. */
  accent?: 'violet' | 'emerald';
};

const PAD = { top: 16, right: 16, bottom: 28, left: 44 };
const VIEW_W = 720;
const VIEW_H = 280;

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

const ACCENTS = {
  violet: { stroke: 'var(--aster-primary, #7c3aed)', text: 'text-[var(--aster-primary,#7c3aed)]' },
  emerald: { stroke: 'var(--aster-success, #059669)', text: 'text-emerald-600 dark:text-emerald-400' },
} as const;

export function ParityTrendChart({ points, labels, locale, accent = 'violet' }: Props) {
  const gradId = useId();
  const [range, setRange] = useState<RangeKey>('all');
  const [hover, setHover] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Sort ascending by time and filter to the chosen window (relative to the
  // most recent point, so the chart stays meaningful even on stale data).
  const sorted = useMemo(
    () => [...points].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp)),
    [points],
  );

  const data = useMemo(() => {
    if (range === 'all' || sorted.length === 0) return sorted;
    const newest = +new Date(sorted[sorted.length - 1]!.timestamp);
    const cutoff = newest - RANGE_DAYS[range] * 86_400_000;
    const filtered = sorted.filter((p) => +new Date(p.timestamp) >= cutoff);
    // Always keep at least two points so a line can be drawn.
    return filtered.length >= 2 ? filtered : sorted.slice(-2);
  }, [sorted, range]);

  const { line, area, coords, ticks } = useMemo(() => {
    const rates = data.map((d) => d.rate);
    const lo = Math.min(...rates, 1);
    const hi = Math.max(...rates, 0);
    // Magnified band: floor to the nearest 5% below the min, ceil to 100%.
    const yLo = Math.max(0, Math.floor((lo - 0.001) * 20) / 20);
    const yHi = Math.min(1, Math.ceil((hi + 0.001) * 20) / 20);
    const span = Math.max(yHi - yLo, 0.05);

    const innerW = VIEW_W - PAD.left - PAD.right;
    const innerH = VIEW_H - PAD.top - PAD.bottom;
    const xOf = (i: number) =>
      PAD.left + (data.length <= 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
    const yOf = (r: number) => PAD.top + (1 - (r - yLo) / span) * innerH;

    const pts = data.map((d, i) => ({ x: xOf(i), y: yOf(d.rate), d }));
    const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath =
      pts.length > 0
        ? `${linePath} L${pts[pts.length - 1]!.x.toFixed(1)},${(VIEW_H - PAD.bottom).toFixed(1)} ` +
          `L${pts[0]!.x.toFixed(1)},${(VIEW_H - PAD.bottom).toFixed(1)} Z`
        : '';

    // 4 horizontal gridlines / y ticks.
    const tickVals = Array.from({ length: 4 }, (_, i) => yLo + (span * i) / 3);
    return {
      line: linePath,
      area: areaPath,
      coords: pts,
      ticks: tickVals.map((v) => ({ v, y: yOf(v) })),
    };
  }, [data]);

  const a = ACCENTS[accent];
  const active = hover != null ? coords[hover] : undefined;

  if (sorted.length === 0) {
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
    const newest = +new Date(sorted[sorted.length - 1]!.timestamp);
    const oldest = +new Date(sorted[0]!.timestamp);
    // Only offer a range if the data actually spans at least ~half of it
    // (a "week" toggle is pointless if all data is from one day).
    return newest - oldest >= RANGE_DAYS[r] * 86_400_000 * 0.5;
  });
  const ranges = availableRanges.length >= 2 ? availableRanges : (['all'] as RangeKey[]);

  return (
    <section className="mb-12">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
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

      <div className="relative rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900 sm:p-5">
        <svg
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full"
          style={{ aspectRatio: `${VIEW_W} / ${VIEW_H}` }}
          role="img"
          aria-label={labels.heading}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
            // nearest point by x
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < coords.length; i++) {
              const dist = Math.abs(coords[i]!.x - x);
              if (dist < bestDist) {
                bestDist = dist;
                best = i;
              }
            }
            setHover(best);
          }}
        >
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={a.stroke} stopOpacity="0.22" />
              <stop offset="100%" stopColor={a.stroke} stopOpacity="0" />
            </linearGradient>
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

          {/* area + line */}
          <path d={area} fill={`url(#${gradId})`} />
          <path
            d={line}
            fill="none"
            stroke={a.stroke}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            className="motion-safe:[stroke-dasharray:1600] motion-safe:[stroke-dashoffset:1600] motion-safe:[animation:parity-draw_900ms_cubic-bezier(0.22,1,0.36,1)_forwards]"
          />

          {/* latest point marker (always shown) */}
          {coords.length > 0 && (
            <circle
              cx={coords[coords.length - 1]!.x}
              cy={coords[coords.length - 1]!.y}
              r="3.5"
              fill={a.stroke}
              className="stroke-white dark:stroke-gray-900"
              strokeWidth="2"
            />
          )}

          {/* hover crosshair + point */}
          {active && (
            <g>
              <line
                x1={active.x}
                x2={active.x}
                y1={PAD.top}
                y2={VIEW_H - PAD.bottom}
                className="stroke-gray-300 dark:stroke-gray-600"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
              <circle
                cx={active.x}
                cy={active.y}
                r="4.5"
                fill={a.stroke}
                className="stroke-white dark:stroke-gray-900"
                strokeWidth="2"
              />
            </g>
          )}

          {/* x labels: first + last (+ middle when room) */}
          {coords.length > 0 &&
            [0, coords.length - 1]
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .map((idx) => (
                <text
                  key={idx}
                  x={coords[idx]!.x}
                  y={VIEW_H - 8}
                  textAnchor={idx === 0 ? 'start' : 'end'}
                  className="fill-gray-400 font-mono text-[10px] dark:fill-gray-500"
                >
                  {fmtDate(coords[idx]!.d.timestamp, locale, { month: 'short', day: 'numeric' })}
                </text>
              ))}
        </svg>

        {/* tooltip */}
        {active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={{
              left: `calc(${(active.x / VIEW_W) * 100}% )`,
              top: `calc(${(active.y / VIEW_H) * 100}% - 10px)`,
            }}
          >
            <div className="font-semibold tabular-nums">
              {fmtDate(active.d.timestamp, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
            <div className={'mt-0.5 text-base font-bold tabular-nums ' + a.text}>
              {fmtPercent(active.d.rate, locale)}
            </div>
            <div className="mt-0.5 text-gray-500 tabular-nums dark:text-gray-400">
              {labels.tooltipRatio
                .replace('%value%', String(active.d.value))
                .replace('%total%', String(active.d.total))}
            </div>
          </div>
        )}
      </div>

      {/* progressively-disclosed detail table */}
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
              {[...data].reverse().map((r, i, arr) => {
                const prev = arr[i + 1];
                const delta = prev ? r.rate - prev.rate : null;
                return (
                  <tr key={r.timestamp}>
                    <td className="px-4 py-2 text-sm tabular-nums">
                      {fmtDate(r.timestamp, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
                    </td>
                    <td className="px-4 py-2 text-right text-sm tabular-nums">
                      {r.value} / {r.total}
                    </td>
                    <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
                      {fmtPercent(r.rate, locale)}
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
    </section>
  );
}
