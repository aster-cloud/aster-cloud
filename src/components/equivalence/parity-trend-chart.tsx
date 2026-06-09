/**
 * Parity trend chart — a hand-rolled SVG multi-series line/area chart
 * ("market ticker" feel) for the dual-engine equivalence dashboard.
 *
 * Why no chart library: this is a server-rendered marketing/trust page on
 * Cloudflare Workers under a strict-dynamic CSP. A 100KB+ chart lib (recharts/
 * visx) would bloat the bundle and risk inline-style/eval CSP friction. The
 * trend is a handful of points — a bespoke SVG is lighter, fully themeable,
 * and renders identically server- and client-side.
 *
 * Plots multiple series on shared axes (parse-acceptance parity + runtime
 * eval parity). Features: adjustable time range (week / month / year / all),
 * a magnified y-axis that focuses on the actual value band (the way a market
 * index chart zooms into the relevant range), a legend, hover crosshair +
 * tooltip with the nearest point across all series, and a
 * progressively-disclosed detail table. A series with a single data point is
 * drawn as a marker (no line) so a metric that is just starting to collect a
 * baseline shows up honestly instead of vanishing.
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

export type SeriesAccent = 'violet' | 'emerald';

export type TrendSeries = {
  key: string;
  label: string;
  accent: SeriesAccent;
  points: TrendPoint[];
  /** Draw the gradient area fill under this series (only the primary one). */
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

const PAD = { top: 18, right: 16, bottom: 28, left: 44 };
const VIEW_W = 720;
const VIEW_H = 280;

const ACCENTS: Record<SeriesAccent, { stroke: string; text: string; dot: string }> = {
  violet: {
    stroke: 'var(--aster-primary, #7c3aed)',
    text: 'text-[var(--aster-primary,#7c3aed)]',
    dot: 'bg-[var(--aster-primary,#7c3aed)]',
  },
  emerald: {
    stroke: 'var(--aster-success, #059669)',
    text: 'text-emerald-600 dark:text-emerald-400',
    dot: 'bg-emerald-600 dark:bg-emerald-400',
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

export function ParityTrendChart({ series, labels, locale }: Props) {
  const gradId = useId();
  const [range, setRange] = useState<RangeKey>('all');
  // hover holds the flattened index into `flatPoints`.
  const [hover, setHover] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Sort each series ascending by time.
  const sortedSeries = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        points: [...s.points].sort((a, b) => +new Date(a.timestamp) - +new Date(b.timestamp)),
      })),
    [series],
  );

  // The widest time span across series, used for range-toggle availability.
  const allTimes = useMemo(
    () => sortedSeries.flatMap((s) => s.points.map((p) => +new Date(p.timestamp))),
    [sortedSeries],
  );
  const newest = allTimes.length ? Math.max(...allTimes) : 0;
  const oldest = allTimes.length ? Math.min(...allTimes) : 0;

  const rangedSeries = useMemo(() => {
    if (range === 'all') return sortedSeries;
    const cutoff = newest - RANGE_DAYS[range] * 86_400_000;
    return sortedSeries.map((s) => {
      const filtered = s.points.filter((p) => +new Date(p.timestamp) >= cutoff);
      return { ...s, points: filtered };
    });
  }, [sortedSeries, range, newest]);

  const geom = useMemo(() => {
    const rates = rangedSeries.flatMap((s) => s.points.map((p) => p.rate));
    if (rates.length === 0) {
      return { paths: [], ticks: [], flat: [] as { x: number; y: number; p: TrendPoint; s: TrendSeries }[], xMin: 0, xMax: 1 };
    }
    const lo = Math.min(...rates);
    const hi = Math.max(...rates);
    const yLo = Math.max(0, Math.floor((lo - 0.001) * 20) / 20);
    const yHi = Math.min(1, Math.ceil((hi + 0.001) * 20) / 20);
    const span = Math.max(yHi - yLo, 0.05);

    // Shared x-domain = full time extent of the ranged data.
    const times = rangedSeries.flatMap((s) => s.points.map((p) => +new Date(p.timestamp)));
    const tMin = Math.min(...times);
    const tMax = Math.max(...times);
    const tSpan = Math.max(tMax - tMin, 1);

    const innerW = VIEW_W - PAD.left - PAD.right;
    const innerH = VIEW_H - PAD.top - PAD.bottom;
    const xOf = (t: number) => PAD.left + ((t - tMin) / tSpan) * innerW;
    const yOf = (r: number) => PAD.top + (1 - (r - yLo) / span) * innerH;

    const paths = rangedSeries.map((s) => {
      const pts = s.points.map((p) => ({ x: xOf(+new Date(p.timestamp)), y: yOf(p.rate), p }));
      const line = pts.map((pt, i) => `${i === 0 ? 'M' : 'L'}${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
      const area =
        s.area && pts.length >= 2
          ? `${line} L${pts[pts.length - 1]!.x.toFixed(1)},${(VIEW_H - PAD.bottom).toFixed(1)} ` +
            `L${pts[0]!.x.toFixed(1)},${(VIEW_H - PAD.bottom).toFixed(1)} Z`
          : '';
      return { s, pts, line, area, single: pts.length === 1 };
    });

    const flat = paths.flatMap((path) => path.pts.map((pt) => ({ x: pt.x, y: pt.y, p: pt.p, s: path.s })));

    const tickVals = Array.from({ length: 4 }, (_, i) => yLo + (span * i) / 3);
    const ticks = tickVals.map((v) => ({ v, y: yOf(v) }));
    return { paths, ticks, flat, xMin: tMin, xMax: tMax };
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

  // Range availability: only offer a window the data actually spans ~half of.
  const availableRanges = (['week', 'month', 'year', 'all'] as RangeKey[]).filter((r) => {
    if (r === 'all') return true;
    return newest - oldest >= RANGE_DAYS[r] * 86_400_000 * 0.5;
  });
  const ranges = availableRanges.length >= 2 ? availableRanges : (['all'] as RangeKey[]);

  const active = hover != null ? geom.flat[hover] : undefined;
  // The primary (first) series drives x-axis date labels.
  const primary = geom.paths.find((p) => p.pts.length >= 2) ?? geom.paths[0];

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
        {sortedSeries
          .filter((s) => s.points.length > 0)
          .map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <span className={'inline-block h-2.5 w-2.5 rounded-full ' + ACCENTS[s.accent].dot} aria-hidden />
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
            if (geom.flat.length === 0) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * VIEW_W;
            const y = ((e.clientY - rect.top) / rect.height) * VIEW_H;
            let best = 0;
            let bestDist = Infinity;
            for (let i = 0; i < geom.flat.length; i++) {
              const dx = geom.flat[i]!.x - x;
              const dy = geom.flat[i]!.y - y;
              const dist = dx * dx + dy * dy * 0.25; // weight x more than y
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
              <stop offset="0%" stopColor={ACCENTS.violet.stroke} stopOpacity="0.2" />
              <stop offset="100%" stopColor={ACCENTS.violet.stroke} stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* y gridlines + labels */}
          {geom.ticks.map((t, i) => (
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

          {/* area (primary series only) */}
          {geom.paths.map(
            (path, i) =>
              path.area && <path key={`a${i}`} d={path.area} fill={`url(#${gradId})`} />,
          )}

          {/* lines (multi-point series) */}
          {geom.paths.map((path, i) =>
            path.single ? null : (
              <path
                key={`l${i}`}
                d={path.line}
                fill="none"
                stroke={ACCENTS[path.s.accent].stroke}
                strokeWidth="2.5"
                strokeLinejoin="round"
                strokeLinecap="round"
                className="motion-safe:[stroke-dasharray:1600] motion-safe:[stroke-dashoffset:1600] motion-safe:[animation:parity-draw_900ms_cubic-bezier(0.22,1,0.36,1)_forwards]"
              />
            ),
          )}

          {/* single-point series: marker + soft halo so it doesn't vanish */}
          {geom.paths.map((path, i) =>
            path.single && path.pts[0] ? (
              <g key={`s${i}`}>
                <circle
                  cx={path.pts[0].x}
                  cy={path.pts[0].y}
                  r="7"
                  fill={ACCENTS[path.s.accent].stroke}
                  opacity="0.15"
                />
                <circle
                  cx={path.pts[0].x}
                  cy={path.pts[0].y}
                  r="4"
                  fill={ACCENTS[path.s.accent].stroke}
                  className="stroke-white dark:stroke-gray-900"
                  strokeWidth="2"
                />
              </g>
            ) : null,
          )}

          {/* latest-point markers for multi-point series */}
          {geom.paths.map((path, i) =>
            !path.single && path.pts.length > 0 ? (
              <circle
                key={`m${i}`}
                cx={path.pts[path.pts.length - 1]!.x}
                cy={path.pts[path.pts.length - 1]!.y}
                r="3.5"
                fill={ACCENTS[path.s.accent].stroke}
                className="stroke-white dark:stroke-gray-900"
                strokeWidth="2"
              />
            ) : null,
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
                fill={ACCENTS[active.s.accent].stroke}
                className="stroke-white dark:stroke-gray-900"
                strokeWidth="2"
              />
            </g>
          )}

          {/* x labels: first + last of the primary series */}
          {primary &&
            primary.pts.length > 0 &&
            [0, primary.pts.length - 1]
              .filter((v, i, arr) => arr.indexOf(v) === i)
              .map((idx) => (
                <text
                  key={idx}
                  x={primary.pts[idx]!.x}
                  y={VIEW_H - 8}
                  textAnchor={idx === 0 ? 'start' : 'end'}
                  className="fill-gray-400 font-mono text-[10px] dark:fill-gray-500"
                >
                  {fmtDate(primary.pts[idx]!.p.timestamp, locale, { month: 'short', day: 'numeric' })}
                </text>
              ))}
        </svg>

        {/* tooltip */}
        {active && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-gray-700 dark:bg-gray-800"
            style={{
              left: `${(active.x / VIEW_W) * 100}%`,
              top: `calc(${(active.y / VIEW_H) * 100}% - 10px)`,
            }}
          >
            <div className="flex items-center gap-1.5 font-semibold tabular-nums">
              <span className={'inline-block h-2 w-2 rounded-full ' + ACCENTS[active.s.accent].dot} aria-hidden />
              {active.s.label}
            </div>
            <div className="mt-0.5 text-gray-600 tabular-nums dark:text-gray-300">
              {fmtDate(active.p.timestamp, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
            </div>
            <div className={'mt-0.5 text-base font-bold tabular-nums ' + ACCENTS[active.s.accent].text}>
              {fmtPercent(active.p.rate, locale)}
            </div>
            <div className="mt-0.5 text-gray-500 tabular-nums dark:text-gray-400">
              {labels.tooltipRatio
                .replace('%value%', String(active.p.value))
                .replace('%total%', String(active.p.total))}
            </div>
          </div>
        )}
      </div>

      {/* progressively-disclosed detail table (primary series) */}
      {primary && primary.pts.length > 1 && (
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
                {[...primary.pts].reverse().map(({ p }, i, arr) => {
                  const prev = arr[i + 1]?.p;
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
