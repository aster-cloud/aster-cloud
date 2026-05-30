/**
 * Lexicon SSE invalidation publisher (B14)
 *
 * In-process pub/sub via Node EventEmitter. v1 is single-pod; cross-pod
 * fanout will need Redis pub/sub in a follow-up. Clients connect via
 * GET /api/v1/domain-vocabularies/stream and receive `vocabulary.invalidate`
 * events so the Monaco editor can refetch the affected (domain, locale)
 * vocab and reregister without a full page reload.
 *
 * The invalidate signal is intentionally minimal: it carries only enough
 * scope to let the client decide whether to refetch. We never push raw term
 * content over SSE.
 */

import { EventEmitter } from 'node:events';

export interface InvalidateEvent {
  type: 'invalidate';
  /** Monotonic per-process event id; the SSE route uses this for SSE `id:` */
  id: string;
  ownerType: 'user' | 'team';
  ownerId: string;
  domain?: string;
  locale?: string;
  cause:
    | 'term.add'
    | 'term.modify'
    | 'term.delete'
    | 'term.restore'
    | 'bulk.sync'
    | 'bulk.async'
    | 'rollback';
  at: string;
}

const emitter = new EventEmitter();
// 100 concurrent SSE clients per pod is generous; bump if we ever ship a
// per-user broadcasts model that overflows.
emitter.setMaxListeners(100);

const CHANNEL = 'lexicon.invalidate';

let eventSeq = 0;

/** Service-layer publisher. Called from add/modify/delete/bulk/rollback. */
export function publishVocabularyInvalidate(event: Omit<InvalidateEvent, 'type' | 'at' | 'id'>): void {
  eventSeq += 1;
  const payload: InvalidateEvent = {
    type: 'invalidate',
    // Per-process monotonic id: clients can pass it back via Last-Event-ID
    // on reconnect so the server (or the client) knows whether a refetch
    // is needed. v1 keeps this in-memory; v2 cross-pod fanout will persist.
    id: `${process.pid}-${eventSeq}`,
    at: new Date().toISOString(),
    ...event,
  };
  // Emit asynchronously so the caller's transaction commit semantics are
  // not affected by listener throws.
  queueMicrotask(() => emitter.emit(CHANNEL, payload));
}

/**
 * Subscribe to invalidate events for a specific owner. Returns the
 * unsubscribe callback.
 */
export function subscribeVocabularyInvalidate(
  scope: { ownerType: 'user' | 'team'; ownerId: string },
  handler: (event: InvalidateEvent) => void,
): () => void {
  const listener = (event: InvalidateEvent) => {
    if (event.ownerType !== scope.ownerType) return;
    if (event.ownerId !== scope.ownerId) return;
    try {
      handler(event);
    } catch (err) {
      console.error('[lexicon-events] subscriber threw', err);
    }
  };
  emitter.on(CHANNEL, listener);
  return () => {
    emitter.off(CHANNEL, listener);
  };
}

/** Total active SSE listener count. Used by metrics + tests. */
export function listenerCount(): number {
  return emitter.listenerCount(CHANNEL);
}
