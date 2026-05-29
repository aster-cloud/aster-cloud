/**
 * withIdempotency middleware tests.
 *
 * The reserve-first contract:
 *   1. Look up an existing row for (userId, routeKey, idempotencyKey)
 *   2. If terminal + same hash: replay
 *   3. If pending: poll for the winner's result
 *   4. If expired: delete it
 *   5. Otherwise: insert a `pending` reservation row, run handler, update row
 *      with the terminal response, return it
 *
 * Concurrency safety: only one request runs the handler per key.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const findFirst = vi.fn();
  const deleteWhere = vi.fn().mockResolvedValue(undefined);
  const deleteFn = vi.fn().mockReturnValue({ where: deleteWhere });
  const updateWhere = vi.fn().mockResolvedValue(undefined);
  const updateSet = vi.fn().mockReturnValue({ where: updateWhere });
  const update = vi.fn().mockReturnValue({ set: updateSet });
  const insertReturning = vi.fn();
  const onConflictDoNothing = vi.fn().mockReturnValue({ returning: insertReturning });
  const insertValues = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values: insertValues });
  return {
    findFirst,
    deleteWhere,
    deleteFn,
    update,
    updateSet,
    updateWhere,
    insertReturning,
    onConflictDoNothing,
    insertValues,
    insert,
  };
});

vi.mock('@/lib/prisma', () => ({
  db: {
    query: {
      lexiconIdempotencyKeys: { findFirst: hoisted.findFirst },
    },
    delete: hoisted.deleteFn,
    insert: hoisted.insert,
    update: hoisted.update,
  },
  lexiconIdempotencyKeys: {
    id: {},
    userId: {},
    routeKey: {},
    idempotencyKey: {},
  },
}));

import {
  IdempotencyConflictError,
  IdempotencyKeyInvalidError,
  withIdempotency,
} from '@/lib/api/idempotency';

function req(body: unknown, key?: string): Request {
  const headers: Record<string, string> = body === undefined ? {} : { 'content-type': 'application/json' };
  if (key !== undefined) headers['Idempotency-Key'] = key;
  return new Request('https://example.test/api', {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.findFirst.mockResolvedValue(undefined);
  hoisted.insertReturning.mockResolvedValue([{ id: 'reservation-1' }]);
  hoisted.onConflictDoNothing.mockReturnValue({ returning: hoisted.insertReturning });
  hoisted.insertValues.mockReturnValue({ onConflictDoNothing: hoisted.onConflictDoNothing });
  hoisted.insert.mockReturnValue({ values: hoisted.insertValues });
  hoisted.deleteFn.mockReturnValue({ where: hoisted.deleteWhere });
  hoisted.update.mockReturnValue({ set: hoisted.updateSet });
  hoisted.updateSet.mockReturnValue({ where: hoisted.updateWhere });
});

describe('withIdempotency', () => {
  it('runs the handler with no idempotency persistence when the header is absent', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { ok: true } });

    const result = await withIdempotency(
      req({ a: 1 }),
      { userId: 'u1', routeKey: 'POST /terms' },
      handler,
    );

    expect(result).toEqual({ status: 201, body: { ok: true }, replayed: false });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(hoisted.insert).not.toHaveBeenCalled();
    expect(hoisted.findFirst).not.toHaveBeenCalled();
  });

  it('replays the stored response when a terminal row exists with the same body hash', async () => {
    // Pre-populate a "stored" row that matches whatever hash withIdempotency
    // is about to compute for the request body. Capture the hash by reading
    // it back from the first insert call inside the same describe scope is
    // brittle; instead we run a once-through to learn the hash, then reset
    // mocks and provide a terminal row for the replay path.
    let capturedHash = '';
    hoisted.insertValues.mockImplementationOnce((values: { requestHash: string }) => {
      capturedHash = values.requestHash;
      return { onConflictDoNothing: hoisted.onConflictDoNothing };
    });

    await withIdempotency(
      req({ a: 1 }, 'k1'),
      { userId: 'u1', routeKey: 'POST /terms' },
      async () => ({ status: 201, body: { ok: true } }),
    );

    // Reset insert spies for the replay path, but keep the captured hash.
    vi.clearAllMocks();
    hoisted.findFirst.mockResolvedValueOnce({
      id: 'idem-1',
      requestHash: capturedHash,
      responseStatus: 201,
      responseBody: { ok: true },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const handler = vi.fn();
    const replay = await withIdempotency(
      req({ a: 1 }, 'k1'),
      { userId: 'u1', routeKey: 'POST /terms' },
      handler,
    );

    expect(replay).toEqual({ status: 201, body: { ok: true }, replayed: true });
    expect(handler).not.toHaveBeenCalled();
  });

  it('throws IdempotencyConflictError when the same key sees a different body', async () => {
    hoisted.findFirst.mockResolvedValueOnce({
      id: 'idem-old',
      requestHash: 'a-completely-different-hash',
      responseStatus: 201,
      responseBody: { ok: true },
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(
      withIdempotency(
        req({ a: 1 }, 'k1'),
        { userId: 'u1', routeKey: 'POST /terms' },
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it('deletes an expired row and runs the handler fresh', async () => {
    hoisted.findFirst.mockResolvedValueOnce({
      id: 'idem-old',
      requestHash: 'old-hash',
      responseStatus: 200,
      responseBody: { old: true },
      expiresAt: new Date(Date.now() - 60_000),
    });
    const handler = vi.fn().mockResolvedValue({ status: 200, body: { fresh: true } });

    const result = await withIdempotency(
      req({ a: 1 }, 'k1'),
      { userId: 'u1', routeKey: 'POST /terms' },
      handler,
    );

    expect(hoisted.deleteFn).toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result.replayed).toBe(false);
    expect(result.body).toEqual({ fresh: true });
  });

  it('rejects malformed (oversize) keys before any DB IO', async () => {
    await expect(
      withIdempotency(
        req({ a: 1 }, 'x'.repeat(256)),
        { userId: 'u1', routeKey: 'POST /terms' },
        vi.fn(),
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyInvalidError);
    expect(hoisted.findFirst).not.toHaveBeenCalled();
  });

  it('reserves the key BEFORE running the handler and updates with the result', async () => {
    const handler = vi.fn().mockResolvedValue({ status: 201, body: { ok: true } });

    await withIdempotency(
      req({ a: 1 }, 'k1'),
      { userId: 'u1', routeKey: 'POST /terms' },
      handler,
    );

    // Verify ordering: insert (reservation) → handler → update (terminal).
    const insertOrder = hoisted.insertValues.mock.invocationCallOrder[0];
    const handlerOrder = handler.mock.invocationCallOrder[0];
    const updateOrder = hoisted.updateSet.mock.invocationCallOrder[0];

    expect(insertOrder).toBeLessThan(handlerOrder);
    expect(handlerOrder).toBeLessThan(updateOrder);
    expect(hoisted.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({ responseStatus: 201, responseBody: { ok: true } }),
    );
  });

  it('deletes the reservation row if the handler throws', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('boom'));

    await expect(
      withIdempotency(req({ a: 1 }, 'k1'), { userId: 'u1', routeKey: 'POST /terms' }, handler),
    ).rejects.toThrow('boom');

    expect(hoisted.deleteFn).toHaveBeenCalled();
    expect(hoisted.update).not.toHaveBeenCalled();
  });
});
