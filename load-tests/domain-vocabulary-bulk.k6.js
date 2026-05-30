// k6 load test for /api/v1/domain-vocabularies/bulk (B15)
//
// Targets:
//   - p95(sync ≤500 rows) < 2s
//   - p95(async enqueue) < 500ms
//   - 100 concurrent users polling /bulk/jobs/[id]
//
// Usage:
//   BASE_URL=https://staging.aster-lang.cloud \
//   AUTH_COOKIE='next-auth.session-token=...' \
//   k6 run load-tests/domain-vocabulary-bulk.k6.js
//
// The Authorization model uses NextAuth session cookies; rotate the cookie
// for each test run (staging-only). DO NOT use a production cookie.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

const BASE = __ENV.BASE_URL ?? 'http://localhost:3000';
const COOKIE = __ENV.AUTH_COOKIE ?? '';

const syncDuration = new Trend('lexicon_bulk_sync_duration_ms', true);
const asyncEnqueueDuration = new Trend('lexicon_bulk_async_enqueue_duration_ms', true);
const jobPollDuration = new Trend('lexicon_bulk_job_poll_duration_ms', true);

export const options = {
  scenarios: {
    sync_bulk: {
      executor: 'ramping-vus',
      exec: 'syncBulk',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '1m', target: 10 },
        { duration: '15s', target: 0 },
      ],
    },
    async_enqueue: {
      executor: 'ramping-vus',
      exec: 'asyncEnqueue',
      startVUs: 1,
      stages: [
        { duration: '30s', target: 25 },
        { duration: '1m', target: 25 },
        { duration: '15s', target: 0 },
      ],
      startTime: '0s',
    },
    job_polling: {
      executor: 'constant-vus',
      exec: 'pollJob',
      vus: 100,
      duration: '2m',
      startTime: '15s',
    },
  },
  thresholds: {
    'lexicon_bulk_sync_duration_ms': ['p(95)<2000'],
    'lexicon_bulk_async_enqueue_duration_ms': ['p(95)<500'],
    'http_req_failed': ['rate<0.05'],
  },
};

function makeTerms(count) {
  const rows = [];
  for (let i = 0; i < count; i += 1) {
    rows.push({
      domain: 'finance.loan',
      locale: 'en-US',
      kind: 'struct',
      canonical: `LoadTerm${__VU}_${i}`,
      localized: `Load Term ${__VU} ${i}`,
    });
  }
  return rows;
}

function headers() {
  return {
    'content-type': 'application/json',
    cookie: COOKIE,
    'idempotency-key': `k6-${__VU}-${__ITER}-${Date.now()}`,
  };
}

export function syncBulk() {
  const payload = JSON.stringify({ terms: makeTerms(50) });
  const t0 = Date.now();
  const res = http.post(`${BASE}/api/v1/domain-vocabularies/bulk`, payload, {
    headers: headers(),
  });
  syncDuration.add(Date.now() - t0);
  check(res, {
    'sync bulk 200': (r) => r.status === 200,
  });
  sleep(1);
}

export function asyncEnqueue() {
  const payload = JSON.stringify({ terms: makeTerms(2000) });
  const t0 = Date.now();
  const res = http.post(`${BASE}/api/v1/domain-vocabularies/bulk/jobs`, payload, {
    headers: headers(),
  });
  asyncEnqueueDuration.add(Date.now() - t0);
  check(res, {
    'async enqueue 202': (r) => r.status === 202,
  });
  sleep(2);
}

// Pre-created job ids from a setup script can be passed via JOB_IDS env (comma-separated)
const JOB_IDS = (__ENV.JOB_IDS ?? '').split(',').filter(Boolean);

export function pollJob() {
  if (JOB_IDS.length === 0) return;
  const id = JOB_IDS[__ITER % JOB_IDS.length];
  const t0 = Date.now();
  const res = http.get(`${BASE}/api/v1/domain-vocabularies/bulk/jobs/${id}`, {
    headers: { cookie: COOKIE },
  });
  jobPollDuration.add(Date.now() - t0);
  check(res, {
    'job poll 200': (r) => r.status === 200,
  });
  sleep(0.5);
}
