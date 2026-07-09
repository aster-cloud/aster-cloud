import type { Metadata, Viewport } from "next";
import { headers } from 'next/headers';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { IntlClientProvider } from '@/i18n/intl-client-provider';
import { notFound } from 'next/navigation';
import { Toaster } from '@aster-cloud/ui';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
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
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--aster-font-display-loaded',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});
const inter = Inter({
  subsets: ['latin'],
  variable: '--aster-font-sans-loaded',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--aster-font-mono-loaded',
  display: 'swap',
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
            <AuthProvider>{children}</AuthProvider>
            {/* Global docs search. The palette mounts here (not just
                in the docs layout) so Cmd+K opens it from marketing,
                dashboard, and admin surfaces too. It returns null
                until opened, so the runtime + locale index are only
                fetched on first invocation. The dashboard palette
                uses event-capture + stopPropagation to keep its own
                Cmd+K binding on /dashboard routes. */}
            <DocsCommandPalette />
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
