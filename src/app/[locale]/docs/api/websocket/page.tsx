import { setRequestLocale } from 'next-intl/server';
import { redirectToFirstChild } from '@/lib/docs/section-redirect';

/**
 * /docs/api/websocket — section-parent 308 redirect to the WebSocket
 * preview reference. Prevents breadcrumb-hover 404s.
 */
type Props = {
  params: Promise<{ locale: string }>;
};

export default async function ApiWebsocketIndex({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  redirectToFirstChild(locale, 'api/websocket/preview');
}
