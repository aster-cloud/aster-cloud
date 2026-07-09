'use client';

/**
 * 客户端 i18n Provider 包装。
 *
 * 为什么需要它：`NextIntlClientProvider` 在 server component（layout）里裸用时，缺失 key 的
 * `getMessageFallback` **不会**跨 server→client 边界传递——客户端组件（'use client' 里的
 * useTranslations）遇到缺 key 会**抛 MISSING_MESSAGE 崩页**，而服务端渲染却因 request.ts 的
 * fallback 不崩。这个 wrapper 在 client 边界定义 fallback/onError，让**客户端也 fail-open**：
 * 缺 key 显示 key 路径而非崩溃。与服务端 request.ts 的兜底口径一致。
 *
 * 治本意义：任何未来新增 key 未同步到 npm 包时（如 ui-messages 发版滞后），客户端页面**降级
 * 显示 key 路径而非白屏崩溃**——不再依赖「每次都记得发版」这个人肉纪律。
 */
import { NextIntlClientProvider } from 'next-intl';
import type { ComponentProps, ReactNode } from 'react';

type Messages = ComponentProps<typeof NextIntlClientProvider>['messages'];

export function IntlClientProvider({
  locale,
  messages,
  children,
}: {
  locale: string;
  messages: Messages;
  children: ReactNode;
}) {
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      // 客户端缺失 key 兜底显示原始 key 路径（与 request.ts 服务端口径一致），运行时不抛。
      getMessageFallback={({ namespace, key }) =>
        namespace ? `${namespace}.${key}` : key
      }
      onError={(error) => {
        // 仅非生产打印，避免污染浏览器控制台/日志。
        if (process.env.NODE_ENV !== 'production') {
          console.warn(`[i18n:client] ${error.code}: ${error.message}`);
        }
      }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
