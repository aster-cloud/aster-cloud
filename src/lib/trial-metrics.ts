/*
 * Trial-endpoint observability (Prometheus text exposition).
 *
 * Backs the /api/playground/evaluate-source route. The route is the
 * cloud-side proxy that the marketing playground hits — it gates an
 * anonymous request through Origin + body-size + per-IP rate limits,
 * then signs and forwards to aster-api's internal evaluate-source.
 *
 * Counter outcome labels are deliberately low cardinality so Grafana
 * dashboards can stack them cleanly. New rejection reasons should be
 * added to the TrialOutcome union, not free-formed at the call site.
 *
 * Independent registry — keeps the trial counters from leaking into
 * the default prom-client registry and lets the admin metrics route
 * concatenate them with the license metrics without label collisions.
 */

import { Counter, Histogram, Registry } from 'prom-client';

const registry = new Registry();

/**
 * Possible terminal states for one trial request. Anything that doesn't
 * map to one of these labels is a coding error — add the label here
 * first, then record() it.
 */
export type TrialOutcome =
  | 'accept'
  | 'origin_rejected'
  | 'body_too_large'
  | 'length_required'
  | 'rate_limit_minute'
  | 'rate_limit_hour'
  | 'concurrent_limit'
  | 'method_not_allowed'
  | 'upstream_error'
  | 'upstream_misconfigured';

const trialRequestsTotal = new Counter({
  name: 'aster_trial_evaluate_source_total',
  help: 'Trial /evaluate-source request outcomes from the marketing playground.',
  labelNames: ['outcome'] as const,
  registers: [registry],
});

/**
 * Accept-path latency (sec). Buckets chosen for an evaluate-source
 * payload that compiles a short policy + runs one rule — the 90th
 * percentile in prod lives below 500ms, the 99th below 1.5s; a 5s
 * bucket catches the slow-cold-jar runs without taking up histogram
 * space for hypothetical pathologies.
 */
const trialLatencySeconds = new Histogram({
  name: 'aster_trial_evaluate_source_latency_seconds',
  help: 'Trial /evaluate-source upstream latency (accept path only).',
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

/**
 * Upstream HTTP status (200/4xx/5xx) breakdown. Only emitted for the
 * accept path — rejections short-circuit before any aster-api call.
 * Helps tell apart "ingress denied" vs "policy compile error" without
 * needing per-request logs.
 */
const trialUpstreamStatusTotal = new Counter({
  name: 'aster_trial_evaluate_source_upstream_status_total',
  help: 'Upstream aster-api response status (accept path only).',
  labelNames: ['status_class'] as const,
  registers: [registry],
});

export function recordTrialOutcome(outcome: TrialOutcome): void {
  trialRequestsTotal.inc({ outcome }, 1);
}

export function observeTrialLatency(seconds: number): void {
  if (!Number.isFinite(seconds) || seconds < 0) return;
  trialLatencySeconds.observe(seconds);
}

export function recordTrialUpstreamStatus(httpStatus: number): void {
  const cls =
    httpStatus >= 500 ? '5xx' :
    httpStatus >= 400 ? '4xx' :
    httpStatus >= 200 ? '2xx' :
    'other';
  trialUpstreamStatusTotal.inc({ status_class: cls }, 1);
}

export async function renderTrialMetrics(): Promise<string> {
  return registry.metrics();
}

export function trialMetricsContentType(): string {
  return registry.contentType;
}
