/**
 * SSE invalidate-publisher tests (B14).
 *
 * The publisher is in-process pub/sub; subscribers are scoped to their
 * (ownerType, ownerId) so cross-user events stay isolated. The publisher
 * also defers emission via queueMicrotask so a service-layer caller's
 * transaction commit is unaffected by listener throws.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  listenerCount,
  publishVocabularyInvalidate,
  subscribeVocabularyInvalidate,
} from '@/lib/domain-vocabulary-events';

describe('domain-vocabulary-events', () => {
  it('delivers events to a matching subscriber', async () => {
    const handler = vi.fn();
    const unsubscribe = subscribeVocabularyInvalidate(
      { ownerType: 'user', ownerId: 'user-1' },
      handler,
    );

    publishVocabularyInvalidate({
      ownerType: 'user',
      ownerId: 'user-1',
      domain: 'finance.loan',
      locale: 'en-US',
      cause: 'term.add',
    });

    // queueMicrotask defers emission; await a microtask before asserting.
    await Promise.resolve();
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'invalidate',
        ownerType: 'user',
        ownerId: 'user-1',
        cause: 'term.add',
      }),
    );

    unsubscribe();
    expect(listenerCount()).toBe(0);
  });

  it('isolates events across different owners', async () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    const u1 = subscribeVocabularyInvalidate(
      { ownerType: 'user', ownerId: 'user-1' },
      handler1,
    );
    const u2 = subscribeVocabularyInvalidate(
      { ownerType: 'user', ownerId: 'user-2' },
      handler2,
    );

    publishVocabularyInvalidate({
      ownerType: 'user',
      ownerId: 'user-1',
      cause: 'term.delete',
    });
    await Promise.resolve();

    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();

    u1();
    u2();
  });

  it('swallows subscriber throws so other subscribers continue receiving', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const goodHandler = vi.fn();
    const badHandler = vi.fn(() => {
      throw new Error('subscriber bug');
    });

    const u1 = subscribeVocabularyInvalidate({ ownerType: 'user', ownerId: 'user-x' }, badHandler);
    const u2 = subscribeVocabularyInvalidate({ ownerType: 'user', ownerId: 'user-x' }, goodHandler);

    publishVocabularyInvalidate({
      ownerType: 'user',
      ownerId: 'user-x',
      cause: 'term.add',
    });
    await Promise.resolve();

    expect(badHandler).toHaveBeenCalledTimes(1);
    expect(goodHandler).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();

    u1();
    u2();
    errorSpy.mockRestore();
  });
});
