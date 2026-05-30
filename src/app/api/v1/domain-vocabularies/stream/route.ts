/**
 * GET /api/v1/domain-vocabularies/stream (B14)
 *
 * Server-Sent Events stream of vocabulary invalidation signals scoped to
 * the signed-in user. Browsers subscribe via EventSource; Monaco refetches
 * (domain, locale) vocab on each invalidate.
 *
 * Heartbeat every 15s keeps proxies/CDNs from idling the connection out.
 */

import { getSession } from '@/lib/auth';
import { errorEnvelope } from '@/lib/api/error-envelope';
import {
  subscribeVocabularyInvalidate,
  type InvalidateEvent,
} from '@/lib/domain-vocabulary-events';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(_req: Request) {
  const session = await getSession();
  if (!session?.user?.id) {
    return errorEnvelope({
      status: 401,
      code: 'unauthorized',
      message: 'Sign in required',
    });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown, id?: string) => {
        try {
          const idLine = id ? `id: ${id}\n` : '';
          controller.enqueue(
            encoder.encode(`${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Closed stream; cleanup runs in cancel().
        }
      };

      send('connected', { ownerType: 'user', ownerId: userId });

      unsubscribe = subscribeVocabularyInvalidate(
        { ownerType: 'user', ownerId: userId },
        (event: InvalidateEvent) => {
          // SSE spec: a leading `id:` line tells EventSource to set
          // lastEventId, which it then sends back as Last-Event-ID on
          // reconnect. v1 uses these ids for client-side dedup; v2 cross-pod
          // fanout can use them for replay.
          send('invalidate', event, event.id);
        },
      );

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': heartbeat\n\n'));
        } catch {
          // Closed; cleanup runs in cancel().
        }
      }, HEARTBEAT_INTERVAL_MS);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
