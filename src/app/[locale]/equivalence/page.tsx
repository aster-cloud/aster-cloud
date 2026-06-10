/**
 * Dual-engine equivalence dashboard
 *
 * 公开页面：实时展示 aster-lang-test/equivalence-history.csv 中的最新等价率
 * 和趋势数据。数据在 build 时从 GitHub raw URL 拉取（静态生成）。
 *
 * 目的：把 RFC §9 中描述的"双引擎语义等价"从空头文档变成可被外部审计的事实。
 */
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import {
  ParityTrendChart,
  type ParityTrendLabels,
  type TrendSeries,
  type TrendPoint,
} from '@/components/equivalence/parity-trend-chart';

// 不能 force-static：JSON-LD 内联 <script> 必须带 middleware 设置的 per-request
// CSP nonce（strict-dynamic 下无 nonce 会被拦），而 nonce 是请求级的，
// 静态生成拿不到。读 headers() 自动转为动态渲染。配 revalidate 仍享 ISR 缓存。
export const revalidate = 3600; // 每小时重 revalidate

type Props = {
  params: Promise<{ locale: string }>;
};

type HistoryRow = {
  timestamp: string;
  total: number;
  equivalent: number;
  divergent: number;
  rate: number;
};

// 一个曾经存在、现已解决的运行时分歧（resolved divergence ledger）。
type ResolvedDivergence = {
  case: string;
  ts: string;
  java: string;
  resolution: string;
};

// eval-history.csv 一行：运行时求值一致率趋势（total/identical/divergent/rate）。
type EvalHistoryRow = {
  timestamp: string;
  total: number;
  identical: number;
  divergent: number;
  rate: number;
};

const RAW_BASE = 'https://raw.githubusercontent.com/aster-cloud/aster-lang-test/main';
const HISTORY_URL = `${RAW_BASE}/equivalence-history.csv`;
const EVAL_HISTORY_URL = `${RAW_BASE}/eval-history.csv`;
const IR_HISTORY_URL = `${RAW_BASE}/ir-history.csv`;
const EVAL_COVERAGE_HISTORY_URL = `${RAW_BASE}/eval-coverage-history.csv`;
const FEATURE_COVERAGE_HISTORY_URL = `${RAW_BASE}/feature-coverage-history.csv`;
const REPO_URL = 'https://github.com/aster-cloud/aster-lang-test';

/**
 * 通用趋势 CSV 读取器。所有 history CSV 的列约定一致：第 1 列 timestamp、第 2 列
 * 是分子（identical/equivalent/value）、最后一列是 rate（0..1）。第 3 列若存在则是
 * 分母（total）；ir/eval/parse 的第 2 列是 identical、第 3 列 total 之外还有 divergent，
 * 但分母统一取 total（紧跟 timestamp 之后的那一列在 coverage CSV 是 total）。为稳健，
 * 分母直接读名为 total 的列（位置因 schema 而异），故按表头定位。
 */
async function fetchTrendCsv(url: string): Promise<TrendPoint[]> {
  try {
    const res = await fetch(url, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const text = await res.text();
    const rows = text.trim().split('\n');
    if (rows.length < 2) return [];
    const header = rows[0].split(',');
    const tsIdx = header.indexOf('timestamp');
    const totalIdx = header.indexOf('total');
    const rateIdx = header.indexOf('rate');
    // 分子列：value（coverage CSV）或 identical/equivalent（parity CSV）。
    const valueIdx = ['value', 'identical', 'equivalent'].map((c) => header.indexOf(c)).find((i) => i >= 0) ?? -1;
    return rows.slice(1).map((line) => {
      const cols = line.split(',');
      const total = Number(cols[totalIdx]);
      const value = valueIdx >= 0 ? Number(cols[valueIdx]) : total;
      return {
        timestamp: cols[tsIdx],
        total,
        value,
        rate: rateIdx >= 0 ? Number(cols[rateIdx]) : total > 0 ? value / total : 0,
      };
    });
  } catch {
    return [];
  }
}

async function fetchHistory(): Promise<HistoryRow[]> {
  try {
    const res = await fetch(HISTORY_URL, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split('\n').slice(1); // skip header
    return lines.map((line) => {
      const [timestamp, total, equivalent, divergent, rate] = line.split(',');
      return {
        timestamp,
        total: Number(total),
        equivalent: Number(equivalent),
        divergent: Number(divergent),
        rate: Number(rate),
      };
    });
  } catch {
    return [];
  }
}

async function fetchEvalHistory(): Promise<EvalHistoryRow[]> {
  try {
    const res = await fetch(EVAL_HISTORY_URL, { next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split('\n').slice(1); // skip header
    return lines.map((line) => {
      const [timestamp, total, identical, divergent, rate] = line.split(',');
      return {
        timestamp,
        total: Number(total),
        identical: Number(identical),
        divergent: Number(divergent),
        rate: Number(rate),
      };
    });
  } catch {
    return [];
  }
}

/**
 * 同一天多组测量 → 每天只保留最新一条（按 timestamp 取最大）。
 * 用 UTC 日期作分组键，与 CSV 的 ISO timestamp 一致；输出按时间升序。
 */
function dedupeByDay(points: TrendPoint[]): TrendPoint[] {
  const byDay = new Map<string, TrendPoint>();
  for (const p of points) {
    const day = p.timestamp.slice(0, 10); // YYYY-MM-DD (UTC)
    const existing = byDay.get(day);
    if (!existing || p.timestamp > existing.timestamp) {
      byDay.set(day, p);
    }
  }
  return [...byDay.values()].sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'equivalencePage.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/equivalence` },
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
    },
  };
}

function formatPercent(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(n);
}

function formatTimestamp(iso: string, locale: string): string {
  try {
    // UTC: timestamps are UTC ISO strings; pin the zone so the rendered date is
    // stable and matches the chart's UTC-formatted labels (and avoids any
    // server/client zone drift).
    return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', dateStyle: 'medium' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export default async function EquivalencePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  // Per-request CSP nonce set by middleware.ts (x-nonce header). The JSON-LD
  // <script> below must carry it, otherwise strict-dynamic CSP blocks it.
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  const t = await getTranslations('equivalencePage');
  const history = await fetchHistory();
  const latest = history[history.length - 1];
  // 运行时求值一致率（eval-parity）趋势 — 比 parse 接受率更强的指标。
  const evalHistory = await fetchEvalHistory();
  const evalLatest = evalHistory[evalHistory.length - 1];
  // 三条补充趋势：IR 字段级一致率、eval 覆盖率、特性覆盖率（通用 schema CSV）。
  const irHistory = await fetchTrendCsv(IR_HISTORY_URL);
  const evalCoverageHistory = await fetchTrendCsv(EVAL_COVERAGE_HISTORY_URL);
  const featureCoverageHistory = await fetchTrendCsv(FEATURE_COVERAGE_HISTORY_URL);
  // 已解决分歧台账：曾经 parse 等价但 eval 输出不同、现已修复的样本。
  // 公开披露「追踪→修复」闭环，比隐藏历史更可信。
  const resolvedDivergences = t.raw('resolvedDivergences.rows') as ResolvedDivergence[];

  // 走势图：两条 series —— 解析一致率（紫，主线，带面积）+ 运行求值一致率（绿）。
  // client 子组件渲染交互式多线 SVG 图。eval 当前可能只有 1 点 → 显示为单点标记。
  //
  // 同一天若有多组测量（nightly cron + 手动 dispatch，或修复后重跑），图上每天
  // 只取最新一条（按 timestamp 取最大）——避免一天画多个点造成锯齿/误读。
  const trendSeries: TrendSeries[] = [
    {
      key: 'parse',
      label: t('trend.parseSeries'),
      accent: 'violet',
      area: true,
      points: dedupeByDay(
        history.map((r) => ({
          timestamp: r.timestamp,
          rate: r.rate,
          value: r.equivalent,
          total: r.total,
        })),
      ),
    },
    {
      key: 'eval',
      label: t('trend.evalSeries'),
      accent: 'emerald',
      points: dedupeByDay(
        evalHistory.map((r) => ({
          timestamp: r.timestamp,
          rate: r.rate,
          value: r.identical,
          total: r.total,
        })),
      ),
    },
    {
      key: 'ir',
      label: t('trend.irSeries'),
      accent: 'sky',
      points: dedupeByDay(irHistory),
    },
    {
      key: 'evalCoverage',
      label: t('trend.evalCoverageSeries'),
      accent: 'amber',
      points: dedupeByDay(evalCoverageHistory),
    },
    {
      key: 'featureCoverage',
      label: t('trend.featureCoverageSeries'),
      accent: 'rose',
      points: dedupeByDay(featureCoverageHistory),
    },
  ];
  const trendLabels: ParityTrendLabels = {
    heading: t('trend.heading'),
    ranges: {
      week: t('trend.range.week'),
      month: t('trend.range.month'),
      year: t('trend.range.year'),
      all: t('trend.range.all'),
    },
    tooltipRatio: t('trend.tooltipRatio'),
    delta: t('trend.delta'),
    detailsToggle: t('trend.detailsToggle'),
    colDate: t('trend.date'),
    colRatio: t('trend.ratio'),
    colRate: t('trend.rate'),
    empty: t('trend.empty'),
  };

  // 五个一致性指标的最新值，组成柱状图下方的指标 chip 行（颜色对齐图例）。
  const irLatest = irHistory[irHistory.length - 1];
  const evalCoverageLatest = evalCoverageHistory[evalCoverageHistory.length - 1];
  const featureCoverageLatest = featureCoverageHistory[featureCoverageHistory.length - 1];
  const metricChips = [
    latest && { key: 'parse', accent: 'violet', label: t('chips.parse'), rate: latest.rate, value: latest.equivalent, total: latest.total },
    evalLatest && { key: 'eval', accent: 'emerald', label: t('chips.eval'), rate: evalLatest.rate, value: evalLatest.identical, total: evalLatest.total },
    irLatest && { key: 'ir', accent: 'sky', label: t('chips.ir'), rate: irLatest.rate, value: irLatest.value, total: irLatest.total },
    evalCoverageLatest && { key: 'evalCoverage', accent: 'amber', label: t('chips.evalCoverage'), rate: evalCoverageLatest.rate, value: evalCoverageLatest.value, total: evalCoverageLatest.total },
    featureCoverageLatest && { key: 'featureCoverage', accent: 'rose', label: t('chips.featureCoverage'), rate: featureCoverageLatest.rate, value: featureCoverageLatest.value, total: featureCoverageLatest.total },
  ].filter(Boolean) as { key: string; accent: string; label: string; rate: number; value: number; total: number }[];

  // 指标 chip 的左色点 class（与 ParityTrendChart 的 accent 配色一致）。
  const CHIP_DOT: Record<string, string> = {
    violet: 'bg-[var(--aster-primary,#7c3aed)]',
    emerald: 'bg-emerald-600 dark:bg-emerald-400',
    sky: 'bg-sky-600 dark:bg-sky-400',
    amber: 'bg-amber-600 dark:bg-amber-400',
    rose: 'bg-rose-600 dark:bg-rose-400',
  };

  const jsonLd = latest
    ? {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: 'Aster Lang dual-engine parity history',
        description:
          'Daily-recomputed parity between the Java and TypeScript Aster Lang engines over the declared Tier 1 corpus, across two layers: parse-acceptance parity (both engines accept the same source) and runtime eval parity (both produce identical output on the golden cases). Tracked separately, both published openly alongside a ledger of resolved divergences.',
        url: HISTORY_URL,
        creator: { '@type': 'Organization', name: 'Aster Cloud' },
        license: 'https://opensource.org/license/mit',
        variableMeasured: [
          'parse parity rate (both engines accept / total declared Tier 1 parse-parity samples)',
          'runtime eval parity rate (identical output / total golden cases)',
        ],
        temporalCoverage: `${formatTimestamp(history[0]?.timestamp ?? '', 'en')}/..`,
      }
    : null;

  const footerItems = t.raw('footer.items') as string[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:py-20">
      {jsonLd && (
        <script
          type="application/ld+json"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{t('hero.title')}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-300">
          {t('hero.subtitle')}
        </p>
      </header>

      {!latest && (
        <section className="rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-center dark:border-yellow-700 dark:bg-yellow-900/20">
          <p>
            {t('unavailable')}{' '}
            <a className="underline" href={REPO_URL}>
              {REPO_URL.replace('https://', '')}
            </a>
          </p>
        </section>
      )}

      {latest && (
        <>
          {/* 核心叙事：走势图最先映入眼帘（五层一致性按天并排）。 */}
          {history.length > 1 && (
            <ParityTrendChart series={trendSeries} labels={trendLabels} locale={locale} />
          )}

          {/* 五个一致性指标的当前快照——一行 chip，颜色对齐图例，替代原先散落的
              大卡 / 统计小卡 / 绿卡。每个 chip：色点 + 名称 + 率 + 分子/分母。 */}
          {metricChips.length > 0 && (
            <section className="mb-10 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {metricChips.map((m) => (
                <div
                  key={m.key}
                  className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${CHIP_DOT[m.accent]}`} />
                    <p className="truncate text-xs font-medium text-gray-600 dark:text-gray-300">{m.label}</p>
                  </div>
                  <p className="mt-2 text-2xl font-bold tabular-nums">{formatPercent(m.rate, locale)}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-gray-400 dark:text-gray-500">
                    {m.value} / {m.total}
                  </p>
                </div>
              ))}
            </section>
          )}

          {/* 分层说明：parse 与 eval 的区别（原 hero qualifier 文案，精简保留）。 */}
          <p className="mb-12 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {t('qualifier')}
          </p>

          {resolvedDivergences.length > 0 && (
            <section className="mb-12">
              <h2 className="mb-2 text-xl font-semibold">{t('resolvedDivergences.heading')}</h2>
              <p className="mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
                {t('resolvedDivergences.intro')}
              </p>
              <div className="overflow-x-auto rounded-lg border border-emerald-300 dark:border-emerald-700">
                <table className="min-w-full divide-y divide-emerald-200 dark:divide-emerald-800">
                  <thead className="bg-emerald-50 dark:bg-emerald-900/20">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        {t('resolvedDivergences.colCase')}
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        {t('resolvedDivergences.colWas')}
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                        {t('resolvedDivergences.colResolution')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-emerald-200 dark:divide-emerald-800">
                    {resolvedDivergences.map((d) => (
                      <tr key={d.case}>
                        <td className="px-4 py-2 font-mono text-xs">{d.case}</td>
                        <td className="px-4 py-2 text-xs text-gray-500 line-through dark:text-gray-400">
                          {d.ts} → {d.java}
                        </td>
                        <td className="px-4 py-2 text-xs">✅ {d.resolution}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

        </>
      )}

      <section className="border-t border-gray-200 pt-8 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
        <h3 className="mb-2 font-semibold text-gray-800 dark:text-gray-200">
          {t('footer.heading')}
        </h3>
        <ul className="list-inside list-disc space-y-1">
          {footerItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}
