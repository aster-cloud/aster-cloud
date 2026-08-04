import type { Metadata, Viewport } from "next";
import { headers } from 'next/headers';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { IntlClientProvider } from '@/i18n/intl-client-provider';
import { notFound } from 'next/navigation';
import { Toaster } from '@aster-cloud/ui';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { AssistantProvider } from '@/components/assistant/assistant-context';
import { AssistantPanel } from '@/components/assistant/assistant-panel';
import { AssistantProviderBootstrap } from '@/components/assistant/assistant-provider-bootstrap';
import { DocsCommandPalette } from "@/components/docs/DocsCommandPalette";
import { locales, type Locale } from '@/i18n/config';
import "../globals.css";

// Self-host the brand fonts via next/font/google. Previously globals.css
// did `@import url('https://fonts.googleapis.com/...')` which (a) failed
// in mainland China, (b) introduced FOUT/CLS at first paint, and (c)
// leaked traffic to Google. next/font handles subsetting + preload +
// CSS-variable wiring automatically. The `variable` value is consumed
// inside tokens.css via the --aster-font-{display,sans,mono} tokens
// (see globals.css :root override block).
//
// preload: false —— 三款字体都只含 latin subset，但本站是**多语**（zh/en/de）：
// 在中文优先的页面（如 /zh/demos/*）首屏可见文本是 CJK，浏览器却会预加载这三个
// latin woff2 且短时间内用不上，触发控制台告警
// “The resource <font>.woff2 was preloaded using link preload but not used within
// a few seconds…”。关掉 eager preload：字体仍按需加载（display:'swap' + next/font
// 默认 adjustFontFallback 注入度量校准的回退字体，首屏立即以回退字渲染、**降低**字体
// 交换造成的 CLS——非消除），只是不再发那条在 CJK 页上适得其反的预加载链接。
// 取舍：英文优先页（landing）冷缓存/慢网下字体请求略晚、可能出现一次可见字体交换，
// 换取全站 CJK 页不再有无效高优先级预加载与该告警。
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--aster-font-display-loaded',
  display: 'swap',
  preload: false,
  weight: ['400', '500', '600', '700'],
});
const inter = Inter({
  subsets: ['latin'],
  variable: '--aster-font-sans-loaded',
  display: 'swap',
  preload: false,
  weight: ['400', '500', '600', '700'],
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--aster-font-mono-loaded',
  display: 'swap',
  preload: false,
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: "Aster Cloud — Replay any credit decision",
  description: "Explainable credit-risk decisioning. Replay any loan-approval or limit decision: pull the exact rules and data from that moment and recompute the identical result — proof for regulators, not a guess. Two independent engines verify execution byte-for-byte; a hash-chained audit makes it tamper-evident; rules are versioned and approval-governed.",
  keywords: ["credit risk decisioning", "explainable lending decisions", "loan approval rules", "decision replay", "auditable credit decisions", "model governance", "regulatory explainability", "credit policy management"],
};

// P1-R19: viewport meta — without this mobile browsers render at 980px
// default width until user pinches. Required for responsive design to apply.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

type Props = {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
};

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;

  // Validate that the incoming `locale` parameter is valid
  if (!locales.includes(locale as Locale)) {
    notFound();
  }

  // Enable static rendering
  setRequestLocale(locale);

  // Providing all messages to the client side
  const messages = await getMessages();

  // Per-request CSP nonce, set by middleware.ts on the downstream
  // request header. Threaded into ThemeProvider so the inline
  // <script> it injects for FOUC-free theme bootstrapping passes
  // our strict-dynamic CSP. Without it the script is blocked and
  // users see a one-frame flash from light → dark on first load.
  const requestHeaders = await headers();
  const nonce = requestHeaders.get('x-nonce') ?? undefined;

  return (
    <html
      lang={locale}
      // next-themes flips data-theme on the client before hydration so
      // a server/client mismatch on <html> is expected and benign.
      suppressHydrationWarning
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <head>
        {/*
          esbuild __name polyfill.

          OpenNext-on-Cloudflare bundles the worker with esbuild's
          "keepNames" transform. That transform emits calls to an
          __name helper to preserve `.name` on classes/functions
          after minification. The helper definition lives in the
          worker bundle, BUT some inline <script> fragments that
          land in the HTML (notably next-themes' theme-bootstrap
          and other framework-injected snippets) also reference
          __name without re-declaring it — so the browser throws
          "Uncaught ReferenceError: __name is not defined" on the
          first inline script (seen on /security and any other
          route that hits the same code path).

          Define a no-op-shaped fallback before any other inline
          script runs. The body matches esbuild's own definition
          (sets .name and returns the target) so it's behaviorally
          identical when the bundled helper hasn't loaded yet.
          Nonce is the per-request CSP nonce, identical to the one
          ThemeProvider uses below.
        */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              'globalThis.__name=globalThis.__name||function(t,n){try{Object.defineProperty(t,"name",{value:n,configurable:true})}catch(e){}return t};',
          }}
        />
      </head>
      <body className="antialiased">
        <IntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider nonce={nonce}>
            {/* AssistantProvider 包住 children：面板要**全站驻留**，且在
                marketing/dashboard/docs 之间跳转时保持开合状态与问答记录。
                App Router 下同一 layout 内的客户端组件跨路由不会重新挂载，
                所以状态挂在这一层即可"不随导航丢失"。

                AuthProvider 提到 AssistantProvider 之上：RAG 应答器要按登录态
                注册（见 AssistantProviderBootstrap），故助手子树必须够得到
                session context——原来 AuthProvider 只包 children 就够不到。 */}
            <AuthProvider>
              <AssistantProvider>
                {children}
                {/* Global docs search. The palette mounts here (not just
                    in the docs layout) so Cmd+K opens it from marketing,
                    dashboard, and admin surfaces too. It returns null
                    until opened, so the runtime + locale index are only
                    fetched on first invocation. The dashboard palette
                    uses event-capture + stopPropagation to keep its own
                    Cmd+K binding on /dashboard routes. */}
                <DocsCommandPalette />
                {/* 站内助手面板 —— 放在 Provider 内部、children 之后，
                    这样它渲染在最上层且能读到共享状态。用户在设置里关闭后
                    自身返回 null，不占任何 DOM。 */}
                <AssistantPanel />
                {/* 按登录态注册 RAG 应答器；未登录保持纯离线检索。 */}
                <AssistantProviderBootstrap />
              </AssistantProvider>
            </AuthProvider>
            {/* Global toast outlet. The @aster-cloud/ui Toaster wraps
                sonner with our brand defaults (position, theme="system",
                richColors, closeButton, font-sans). Mounted once at
                locale-layout level so every page can call `toast.*()`
                without owning its own banner state. */}
            <Toaster />
          </ThemeProvider>
        </IntlClientProvider>
      </body>
    </html>
  );
}
