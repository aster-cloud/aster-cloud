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
import { ParityTrendChart, type ParityTrendLabels } from '@/components/equivalence/parity-trend-chart';

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

const HISTORY_URL =
  'https://raw.githubusercontent.com/aster-cloud/aster-lang-test/main/equivalence-history.csv';
const EVAL_HISTORY_URL =
  'https://raw.githubusercontent.com/aster-cloud/aster-lang-test/main/eval-history.csv';
const REPO_URL = 'https://github.com/aster-cloud/aster-lang-test';

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
    return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso));
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
  const initial = history[0];
  // 运行时求值一致率（eval-parity）趋势 — 比 parse 接受率更强的指标。
  const evalHistory = await fetchEvalHistory();
  const evalLatest = evalHistory[evalHistory.length - 1];
  // 已解决分歧台账：曾经 parse 等价但 eval 输出不同、现已修复的样本。
  // 公开披露「追踪→修复」闭环，比隐藏历史更可信。
  const resolvedDivergences = t.raw('resolvedDivergences.rows') as ResolvedDivergence[];

  // 解析一致率走势图的数据点与本地化标签（client 子组件渲染交互式 SVG 图）。
  const trendPoints = history.map((r) => ({
    timestamp: r.timestamp,
    rate: r.rate,
    value: r.equivalent,
    total: r.total,
  }));
  const trendLabels: ParityTrendLabels = {
    heading: t('trend.heading'),
    ranges: {
      week: t('trend.range.week'),
      month: t('trend.range.month'),
      year: t('trend.range.year'),
      all: t('trend.range.all'),
    },
    axisRate: t('trend.rate'),
    axisDate: t('trend.date'),
    tooltipRatio: t('trend.tooltipRatio'),
    delta: t('trend.delta'),
    detailsToggle: t('trend.detailsToggle'),
    colDate: t('trend.date'),
    colRatio: t('trend.ratio'),
    colRate: t('trend.rate'),
    empty: t('trend.empty'),
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
          <section className="mb-12 rounded-2xl bg-gradient-to-br from-primary to-accent p-8 text-white shadow-xl sm:p-12">
            <p className="text-sm uppercase tracking-wider opacity-80">{t('currentRate')}</p>
            <p className="mt-2 text-7xl font-bold tabular-nums sm:text-8xl">
              {formatPercent(latest.rate, locale)}
            </p>
            <p className="mt-2 text-sm opacity-90">
              {t('measuredOn', {
                equivalent: latest.equivalent,
                total: latest.total,
                date: formatTimestamp(latest.timestamp, locale),
              })}
            </p>
            <p className="mt-4 rounded-lg bg-white/15 p-4 text-sm leading-relaxed text-white/95">
              {t('qualifier')}
            </p>
          </section>

          <section className="mb-12 grid gap-6 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('stats.equivalent')}
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{latest.equivalent}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('stats.equivalentDesc')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('stats.divergent')}
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{latest.divergent}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('stats.divergentDesc')}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {t('stats.total')}
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">{latest.total}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('stats.totalDesc')}</p>
            </div>
          </section>

          {evalLatest && (
            <section className="mb-12">
              <h2 className="mb-2 text-xl font-semibold">{t('evalParity.heading')}</h2>
              <p className="mb-4 max-w-2xl text-sm text-gray-600 dark:text-gray-300">
                {t('evalParity.intro')}
              </p>
              <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-6 dark:border-emerald-700 dark:bg-emerald-900/20 sm:p-8">
                <p className="text-sm uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  {t('evalParity.rateLabel')}
                </p>
                <p className="mt-1 text-5xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300 sm:text-6xl">
                  {formatPercent(evalLatest.rate, locale)}
                </p>
                <p className="mt-2 text-sm text-emerald-800/90 dark:text-emerald-200/90">
                  {t('evalParity.measuredOn', {
                    identical: evalLatest.identical,
                    total: evalLatest.total,
                    date: formatTimestamp(evalLatest.timestamp, locale),
                  })}
                </p>
              </div>
            </section>
          )}

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

          {history.length > 1 && (
            <ParityTrendChart points={trendPoints} labels={trendLabels} locale={locale} accent="violet" />
          )}

          {initial && initial.timestamp !== latest.timestamp && (
            <section className="mb-12 rounded-lg border border-gray-200 bg-gray-50 p-6 text-sm dark:border-gray-700 dark:bg-gray-900">
              <p>
                {t('progress', {
                  initial: formatPercent(initial.rate, locale),
                  date: formatTimestamp(initial.timestamp, locale),
                  delta: ((latest.rate - initial.rate) * 100).toFixed(1),
                  count: history.length,
                })}
              </p>
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
