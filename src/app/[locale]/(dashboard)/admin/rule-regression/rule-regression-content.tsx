'use client';

import { useCallback, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Container, PageHeader, Breadcrumbs } from '@/components/ui';

interface ReportRow {
  id: string;
  policyVersionRowId: string;
  status: 'PASS' | 'FAIL_REGRESSION' | 'FAIL_INSUFFICIENT_COVERAGE' | 'NON_REPLAYABLE';
  comparisonMode: string;
  caseCount: number;
  runnableCaseCount: number;
  passedCaseCount: number;
  failedCaseCount: number;
  nonReplayableCaseCount: number;
  reportHash: string;
  currentRuntimeToolchainId: string | null;
  createdAt: string;
  // ★Item 2：签字资格（独立于 status）。list API 承诺总返回，故设为必填——旧后端/异常缺失时前端应 fail-closed
  // 显示「未知」而非绿色（见渲染逻辑）。
  signability: 'SIGNABLE' | 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION';
  unsignableLegacyCases: number | null;
  signablePass: boolean;
}

interface CaseRow {
  id: string;
  policyVersionRowId: string;
  functionName: string;
  locale: string;
  expectedDecision: string | null;
  sourceKind: string;
  coverageTags: string[];
  replayLimited: boolean;
  canonicalInputHash: string;
  createdAt: string;
}

const STATUS_STYLES: Record<ReportRow['status'], string> = {
  PASS: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  FAIL_REGRESSION: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  FAIL_INSUFFICIENT_COVERAGE: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  NON_REPLAYABLE: 'bg-bg-muted text-fg-muted',
};

export function RuleRegressionContent() {
  const t = useTranslations('ruleRegression');
  const [policyId, setPolicyId] = useState('');
  const [versionRow, setVersionRow] = useState('');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const statusLabel = useCallback(
    (s: ReportRow['status']) => {
      switch (s) {
        case 'PASS':
          return t('statusPass');
        case 'FAIL_REGRESSION':
          return t('statusFailRegression');
        case 'FAIL_INSUFFICIENT_COVERAGE':
          return t('statusFailCoverage');
        case 'NON_REPLAYABLE':
          return t('statusNonReplayable');
      }
    },
    [t]
  );

  const load = useCallback(async () => {
    if (!policyId.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ policyId: policyId.trim() });
      if (versionRow.trim()) qs.set('policyVersionRowId', versionRow.trim());
      const res = await fetch(`/api/admin/rule-regression?${qs.toString()}`);
      if (!res.ok) {
        setError(t('loadError'));
        setReports([]);
        setCases([]);
        return;
      }
      const data = (await res.json()) as { reports: ReportRow[]; cases: CaseRow[] };
      setReports(data.reports ?? []);
      setCases(data.cases ?? []);
      setLoaded(true);
    } catch {
      setError(t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [policyId, versionRow, t]);

  return (
    <Container size="xl" className="py-6 sm:py-10">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        breadcrumbs={
          <Breadcrumbs items={[{ label: t('breadcrumbAdmin') }, { label: t('title') }]} />
        }
        className="mb-6"
      />

      <p className="mb-4 rounded-md border border-border bg-bg-muted/40 p-3 text-sm text-fg-muted">
        {t('comparisonNote')}
      </p>

      <section className="mb-8 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-fg-muted">{t('policyIdLabel')}</span>
          <input
            value={policyId}
            onChange={(e) => setPolicyId(e.target.value)}
            placeholder={t('policyIdPlaceholder')}
            className="w-64 rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wider text-fg-muted">{t('versionLabel')}</span>
          <input
            value={versionRow}
            onChange={(e) => setVersionRow(e.target.value)}
            className="w-64 rounded-md border border-border bg-bg px-3 py-2 text-sm"
          />
        </label>
        <button
          onClick={load}
          disabled={loading || !policyId.trim()}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-fg disabled:opacity-50"
        >
          {loading ? t('loading') : t('load')}
        </button>
      </section>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loaded && (
        <>
          <section className="mb-10">
            <h2 className="mb-3 text-lg font-semibold">{t('reportsHeading')}</h2>
            {reports.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('noReports')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-bg-muted/50 text-left text-xs uppercase tracking-wider text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">{t('colStatus')}</th>
                      <th className="px-3 py-2">{t('colVersion')}</th>
                      <th className="px-3 py-2 text-right">{t('colCases')}</th>
                      <th className="px-3 py-2 text-right">{t('colRunnable')}</th>
                      <th className="px-3 py-2 text-right">{t('colPassed')}</th>
                      <th className="px-3 py-2 text-right">{t('colFailed')}</th>
                      <th className="px-3 py-2 text-right">{t('colNonReplayable')}</th>
                      <th className="px-3 py-2">{t('colToolchain')}</th>
                      <th className="px-3 py-2">{t('colReportHash')}</th>
                      <th className="px-3 py-2">{t('colCreated')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reports.map((r) => (
                      <tr key={r.id} className="border-t border-border">
                        <td className="px-3 py-2">
                          <div className="flex flex-col gap-1">
                            {/* 执行结果 badge。★fail-closed：status=PASS 只有 signablePass===true 才用绿色；否则
                                （不可签字或字段缺失/未知）一律中性，绝不误显「绿色可签字」。 */}
                            <span
                              className={`rounded px-2 py-0.5 text-xs font-medium ${
                                r.status === 'PASS' && r.signablePass !== true
                                  ? 'bg-bg-muted text-fg-muted'
                                  : STATUS_STYLES[r.status]
                              }`}
                            >
                              {statusLabel(r.status)}
                            </span>
                            {/* 签字资格 badge（独立轴）。不可签字醒目标注，含 legacy case 数。 */}
                            {r.signability === 'UNSIGNABLE_LEGACY_CASE_HASH_VERSION' && (
                              <span
                                className="rounded px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                                title={t('signabilityUnsignableHint')}
                              >
                                {t('signabilityUnsignable')}
                                {r.unsignableLegacyCases ? ` (${r.unsignableLegacyCases})` : ''}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{r.policyVersionRowId}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.caseCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.runnableCaseCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.passedCaseCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.failedCaseCount}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{r.nonReplayableCaseCount}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.currentRuntimeToolchainId ?? '—'}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.reportHash.slice(0, 12)}…</td>
                        <td className="px-3 py-2 text-xs text-fg-muted">
                          {new Date(r.createdAt).toISOString().slice(0, 19).replace('T', ' ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold">{t('casesHeading')}</h2>
            <p className="mb-3 text-xs text-fg-muted">{t('replayLimitedNote')}</p>
            {cases.length === 0 ? (
              <p className="text-sm text-fg-muted">{t('noCases')}</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-bg-muted/50 text-left text-xs uppercase tracking-wider text-fg-muted">
                    <tr>
                      <th className="px-3 py-2">{t('colFunction')}</th>
                      <th className="px-3 py-2">{t('colLocale')}</th>
                      <th className="px-3 py-2">{t('colDecision')}</th>
                      <th className="px-3 py-2">{t('colSource')}</th>
                      <th className="px-3 py-2">{t('colTags')}</th>
                      <th className="px-3 py-2">{t('colReplayLimited')}</th>
                      <th className="px-3 py-2">{t('colVersion')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((c) => (
                      <tr key={c.id} className="border-t border-border">
                        <td className="px-3 py-2 font-mono text-xs">{c.functionName}</td>
                        <td className="px-3 py-2 text-xs">{c.locale}</td>
                        <td className="px-3 py-2 text-xs">{c.expectedDecision ?? '—'}</td>
                        <td className="px-3 py-2 text-xs">
                          {c.sourceKind === 'execution' ? t('sourceExecution') : t('sourceHandwritten')}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {Array.isArray(c.coverageTags) && c.coverageTags.length > 0 ? c.coverageTags.join(', ') : '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">{c.replayLimited ? t('yes') : t('no')}</td>
                        <td className="px-3 py-2 font-mono text-xs">{c.policyVersionRowId}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </Container>
  );
}
