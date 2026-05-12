/**
 * Dual-engine equivalence dashboard
 *
 * 公开页面：实时展示 aster-lang-test/equivalence-history.csv 中的最新等价率
 * 和趋势数据。数据在 build 时从 GitHub raw URL 拉取（静态生成）。
 *
 * 目的：把 RFC §9 中描述的"双引擎语义等价"从空头文档变成可被外部审计的事实。
 */
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';

export const dynamic = 'force-static';
export const revalidate = 3600; // 每小时重 revalidate（CF Pages 实际取决于 ISR 配置）

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
const RFC_URL =
  'https://github.com/aster-cloud/aster-deploy/blob/main/docs/rfc/dual-engine-syntax-baseline.md';

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
  return {
    title: 'Dual-Engine Equivalence — Aster Lang',
    description:
      "Aster Lang's Java and TypeScript engines are kept semantically equivalent by an automated test corpus. This page shows the live equivalence rate, refreshed nightly.",
    alternates: { canonical: `/${locale}/equivalence` },
    openGraph: {
      title: 'Dual-Engine Equivalence — Aster Lang',
      description:
        'Live equivalence rate between the Java and TypeScript Aster engines.',
      type: 'website',
    },
  };
}

function formatPercent(n: number): string {
  return (n * 100).toFixed(1) + '%';
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso;
  }
}

export default async function EquivalencePage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
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
        temporalCoverage: `${formatTimestamp(history[0]?.timestamp ?? '')}/..`,
      }
    : null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-12 sm:py-20">
      {jsonLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      )}

      <header className="mb-12 text-center">
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          Dual-Engine Equivalence
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600 dark:text-gray-300">
          Aster Lang ships two production engines (Java and TypeScript). We test
          them against a shared corpus every night and publish the result here.
        </p>
      </header>

      {!latest && (
        <section className="rounded-lg border border-yellow-300 bg-yellow-50 p-6 text-center dark:border-yellow-700 dark:bg-yellow-900/20">
          <p>
            Live data unavailable right now. See{' '}
            <a className="underline" href={REPO_URL}>
              the repository
            </a>{' '}
            for the latest measurement.
          </p>
        </section>
      )}

      {latest && (
        <>
          <section className="mb-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 p-8 text-white shadow-xl sm:p-12">
            <p className="text-sm uppercase tracking-wider opacity-80">
              Current equivalence rate
            </p>
            <p className="mt-2 text-7xl font-bold tabular-nums sm:text-8xl">
              {formatPercent(latest.rate)}
            </p>
            <p className="mt-2 text-sm opacity-90">
              {latest.equivalent} / {latest.total} samples — measured{' '}
              {formatTimestamp(latest.timestamp)}
            </p>
          </section>

          <section className="mb-12 grid gap-6 sm:grid-cols-3">
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Equivalent
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {latest.equivalent}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                both engines accept
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Divergent
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {latest.divergent}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                one engine fails
              </p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-900">
              <p className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">
                Total corpus
              </p>
              <p className="mt-2 text-3xl font-semibold tabular-nums">
                {latest.total}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                tier1 + tier2 samples
              </p>
            </div>
          </section>

          {history.length > 1 && (
            <section className="mb-12">
              <h2 className="mb-4 text-xl font-semibold">Trend</h2>
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                  <thead className="bg-gray-50 dark:bg-gray-800">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Date
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Equivalent / Total
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Rate
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Δ
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
                            {formatTimestamp(r.timestamp)}
                          </td>
                          <td className="px-4 py-2 text-right text-sm tabular-nums">
                            {r.equivalent} / {r.total}
                          </td>
                          <td className="px-4 py-2 text-right text-sm font-medium tabular-nums">
                            {formatPercent(r.rate)}
                          </td>
                          <td className="px-4 py-2 text-right text-sm tabular-nums">
                            {delta === null
                              ? '—'
                              : delta === 0
                              ? '0'
                              : (delta > 0 ? '+' : '') +
                                (delta * 100).toFixed(2) +
                                'pp'}
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
                Started at <strong>{formatPercent(initial.rate)}</strong> on{' '}
                {formatTimestamp(initial.timestamp)}. Improved by{' '}
                <strong>
                  +{((latest.rate - initial.rate) * 100).toFixed(1)} percentage points
                </strong>{' '}
                across {history.length} measurements.
              </p>
            </section>
          )}
        </>
      )}

      <section className="border-t border-gray-200 pt-8 text-sm text-gray-600 dark:border-gray-700 dark:text-gray-400">
        <h3 className="mb-2 font-semibold text-gray-800 dark:text-gray-200">
          How this is measured
        </h3>
        <ul className="list-inside list-disc space-y-1">
          <li>
            Source corpus:{' '}
            <a className="underline" href={REPO_URL}>
              aster-cloud/aster-lang-test
            </a>
            , tier1 (equivalence) + tier2 (divergent) samples.
          </li>
          <li>
            Both engines parse every sample. A sample is{' '}
            <em>equivalent</em> only if both engines succeed.
          </li>
          <li>
            Re-measured nightly at 02:00 UTC via the{' '}
            <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">
              nightly-equivalence
            </code>{' '}
            GitHub Action; history committed back to{' '}
            <code className="rounded bg-gray-100 px-1 text-xs dark:bg-gray-800">
              equivalence-history.csv
            </code>
            .
          </li>
          <li>
            See the{' '}
            <a className="underline" href={RFC_URL}>
              dual-engine syntax baseline RFC
            </a>{' '}
            for the methodology.
          </li>
        </ul>
      </section>
    </main>
  );
}
