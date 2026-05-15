/**
 * Dual-engine equivalence dashboard
 *
 * 公开页面：实时展示 aster-lang-test/equivalence-history.csv 中的最新等价率
 * 和趋势数据。数据在 build 时从 GitHub raw URL 拉取（静态生成）。
 *
 * 目的：把 RFC §9 中描述的"双引擎语义等价"从空头文档变成可被外部审计的事实。
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-static';
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

const HISTORY_URL =
  'https://raw.githubusercontent.com/aster-cloud/aster-lang-test/main/equivalence-history.csv';
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
  const t = await getTranslations('equivalencePage');
  const history = await fetchHistory();
  const latest = history[history.length - 1];
  const initial = history[0];

  const jsonLd = latest
    ? {
        '@context': 'https://schema.org',
        '@type': 'Dataset',
        name: 'Aster Lang dual-engine equivalence rate',
        description:
          'Daily-recomputed equivalence rate between the Java and TypeScript Aster Lang engines, measured over the shared aster-lang-test corpus.',
        url: HISTORY_URL,
        creator: { '@type': 'Organization', name: 'Aster Cloud' },
        license: 'https://opensource.org/license/mit',
        variableMeasured: 'equivalence rate (equivalent / total samples)',
        temporalCoverage: `${formatTimestamp(history[0]?.timestamp ?? '', 'en')}/..`,
      }
    : null;

  const footerItems = t.raw('footer.items') as string[];

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:py-20">
      {jsonLd && (
        <script
          type="application/ld+json"
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

          {history.length > 1 && (
            <section className="mb-12">
              <h2 className="mb-4 text-xl font-semibold">{t('trend.heading')}</h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        {t('trend.date')}
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        {t('trend.ratio')}
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        {t('trend.rate')}
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        {t('trend.delta')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                    {[...history].reverse().slice(0, 20).map((r, i, arr) => {
                      const prev = arr[i + 1];
                      const delta = prev ? r.rate - prev.rate : null;
                      return (
                        <tr key={r.timestamp}>
                          <td className="px-4 py-2 text-sm tabular-nums">
                            {formatTimestamp(r.timestamp, locale)}
                          </td>
                          <td className="px-4 py-2 text-right text-sm tabular-nums">
                            {r.equivalent} / {r.total}
                          </td>
                          <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
                            {formatPercent(r.rate, locale)}
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
            </section>
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
