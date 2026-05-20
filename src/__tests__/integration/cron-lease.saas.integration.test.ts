// runCronOnce concurrency + state-transition integration.
//
// Uses real postgres because the dedup contract relies on the
// (job_name, window_start) UNIQUE index + ON CONFLICT DO NOTHING
// semantics; mocking would defeat the test.

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db, cronJobLease } from '@/lib/prisma';
import { runCronOnce } from '@/lib/cron-lease';
import {
  cleanupTestDb,
  setupTestDb,
  teardownTestDb,
} from './setup-postgres';

const JOB = 'user-purge';
const WINDOW = new Date('2026-05-19T04:30:00.000Z');

describe.skipIf(process.env.LICENSE_E2E !== '1')('runCronOnce concurrency', () => {
  beforeAll(async () => {
    (process.env as Record<string, string>).NODE_ENV = 'test';
    process.env.DEPLOYMENT_MODE = 'saas';
    await setupTestDb();
  }, 120_000);

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await cleanupTestDb();
    await db.delete(cronJobLease);
  });

  it('first caller runs; second caller in same window sees skipped=already-done', async () => {
    let ranCount = 0;
    const first = await runCronOnce(
      JOB,
      async () => {
        ranCount++;
        return { processed: 7 };
      },
      { acquiredBy: 'worker-scheduled', windowStart: WINDOW },
    );
    expect(first.ran).toBe(true);
    expect(first.result).toEqual({ processed: 7 });

    const second = await runCronOnce(
      JOB,
      async () => {
        ranCount++;
        return { processed: 99 };
      },
      { acquiredBy: 'http-external', windowStart: WINDOW },
    );
    expect(second.ran).toBe(false);
    expect(second.skippedReason).toBe('already-done');
    expect(ranCount).toBe(1);
  });

  it('different window-start values execute independently', async () => {
    let ranCount = 0;
    const a = await runCronOnce(
      JOB,
      async () => {
        ranCount++;
        return null;
      },
      { acquiredBy: 'worker-scheduled', windowStart: WINDOW },
    );
    const b = await runCronOnce(
      JOB,
      async () => {
        ranCount++;
        return null;
      },
      {
        acquiredBy: 'worker-scheduled',
        windowStart: new Date(WINDOW.getTime() + 86400_000),
      },
    );
    expect(a.ran).toBe(true);
    expect(b.ran).toBe(true);
    expect(ranCount).toBe(2);
  });

  it('parallel calls in same window — only one wins', async () => {
    let ranCount = 0;
    const fn = async () => {
      ranCount++;
      // small delay so both callers reach the INSERT in flight
      await new Promise((r) => setTimeout(r, 25));
      return ranCount;
    };
    const [a, b] = await Promise.all([
      runCronOnce(JOB, fn, { acquiredBy: 'worker-scheduled', windowStart: WINDOW }),
      runCronOnce(JOB, fn, { acquiredBy: 'http-external', windowStart: WINDOW }),
    ]);
    const winners = [a.ran, b.ran].filter(Boolean).length;
    expect(winners).toBe(1);
    expect(ranCount).toBe(1);
  });

  it('thrown errors mark the lease failed + re-throw', async () => {
    await expect(
      runCronOnce(
        JOB,
        async () => {
          throw new Error('boom');
        },
        { acquiredBy: 'worker-scheduled', windowStart: WINDOW },
      ),
    ).rejects.toThrow(/boom/);

    const lease = await db.query.cronJobLease.findFirst({
      where: and(eq(cronJobLease.jobName, JOB), eq(cronJobLease.windowStart, WINDOW)),
    });
    expect(lease?.status).toBe('failed');
    expect(lease?.errorMessage).toBe('boom');

    // Re-running in the same window now sees the failed lease.
    const retry = await runCronOnce(
      JOB,
      async () => 'should-not-run',
      { acquiredBy: 'http-external', windowStart: WINDOW },
    );
    expect(retry.ran).toBe(false);
    expect(retry.skippedReason).toBe('already-failed');
  });

  it('refuses to run unregistered jobName', async () => {
    await expect(
      runCronOnce(
        'not-a-real-cron',
        async () => null,
        { acquiredBy: 'http-external', windowStart: WINDOW },
      ),
    ).rejects.toThrow(/unregistered jobName/);
  });
});
