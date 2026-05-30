/**
 * Lexicon metrics tests (B14).
 *
 * Focuses on the Prometheus exposition contract: counters increment, gauges
 * reflect the latest set call, histograms observe within the right buckets,
 * and the dedup ratio reflects the lifetime ratio of attempts/hits.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  _resetLexiconMetricsForTest,
  lexiconMetricsContentType,
  observeBulkJobDuration,
  observeLexiconOpDuration,
  recordBulkJobRowsProcessed,
  recordLexiconOp,
  recordSnapshotCreate,
  renderLexiconMetrics,
  setLexiconSnapshotTotal,
  setLexiconTermTotal,
  setLexiconUserLinkTotal,
  snapshotCounters,
} from '@/lib/lexicon-metrics';

beforeEach(() => {
  _resetLexiconMetricsForTest();
});

describe('lexicon-metrics', () => {
  it('exposes a Prometheus text-exposition content type', () => {
    expect(lexiconMetricsContentType()).toContain('text/plain');
  });

  it('renders zero-state metrics without throwing', async () => {
    const text = await renderLexiconMetrics();
    expect(text).toContain('aster_lexicon_term_total');
    expect(text).toContain('aster_lexicon_user_link_total');
  });

  it('increments op counters by op + status', async () => {
    recordLexiconOp('term.add', 'success');
    recordLexiconOp('term.add', 'success');
    recordLexiconOp('term.add', 'error');

    const text = await renderLexiconMetrics();
    expect(text).toMatch(/aster_lexicon_op_total\{op="term\.add",status="success"\} 2/);
    expect(text).toMatch(/aster_lexicon_op_total\{op="term\.add",status="error"\} 1/);
  });

  it('observes op duration into the histogram', async () => {
    observeLexiconOpDuration('term.add', 0.04);
    observeLexiconOpDuration('term.add', 0.6);

    const text = await renderLexiconMetrics();
    expect(text).toContain('aster_lexicon_op_duration_seconds');
    // Two observations land in the cumulative count.
    expect(text).toMatch(/aster_lexicon_op_duration_seconds_count\{op="term\.add"\} 2/);
  });

  it('tracks bulk job durations and rows processed', async () => {
    observeBulkJobDuration('sync', 1.5);
    recordBulkJobRowsProcessed('sync', 250);

    const text = await renderLexiconMetrics();
    expect(text).toMatch(/aster_lexicon_bulk_job_rows_processed_total\{mode="sync"\} 250/);
  });

  it('computes snapshot dedup ratio over lifetime of process', () => {
    recordSnapshotCreate({ dedupHit: false });
    recordSnapshotCreate({ dedupHit: true });
    recordSnapshotCreate({ dedupHit: true });

    const { snapshotCreateAttempts, snapshotCreateHits } = snapshotCounters();
    expect(snapshotCreateAttempts).toBe(3);
    expect(snapshotCreateHits).toBe(2);
  });

  it('reflects setter-style gauge updates in the exposition', async () => {
    setLexiconTermTotal('user', 42);
    setLexiconUserLinkTotal(7);
    setLexiconSnapshotTotal(3);

    const text = await renderLexiconMetrics();
    expect(text).toMatch(/aster_lexicon_term_total\{source="user"\} 42/);
    expect(text).toMatch(/aster_lexicon_user_link_total 7/);
    expect(text).toMatch(/aster_lexicon_snapshot_total 3/);
  });
});
