// Small helper used by every cron route's POST handler to derive
// `(acquiredBy, windowStart)` for runCronOnce.
//
// Cloudflare Workers `scheduled()` dispatches with two headers:
//   - x-cron-source: 'worker-scheduled'
//   - x-cron-window-start: ISO-8601 of event.scheduledTime
//
// External callers (ops curl, GitHub Actions, integration tests)
// usually don't set either; in that case we compute the window-start
// from the registry. Allowing the header lets us run "the same tick"
// from both surfaces idempotently.

import type { NextRequest } from 'next/server';
import { currentWindowStart } from '@/lib/cron-registry';

export function parseCronWindow(
  req: NextRequest,
  jobName: string,
): { acquiredBy: string; windowStart: Date } {
  const source = req.headers.get('x-cron-source')?.trim() || 'http-external';
  const headerTs = req.headers.get('x-cron-window-start')?.trim();
  if (headerTs) {
    const t = Date.parse(headerTs);
    if (Number.isFinite(t)) {
      return { acquiredBy: source, windowStart: new Date(t) };
    }
  }
  return { acquiredBy: source, windowStart: currentWindowStart(jobName) };
}
