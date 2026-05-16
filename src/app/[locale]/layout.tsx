import type { Metadata } from "next";
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { Toaster } from 'sonner';
import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';
import { AuthProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
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
  title: "Aster Cloud - Policy Management Platform",
  description: "Commercial SaaS platform for Aster policy management with PII protection and compliance monitoring.",
  keywords: ["policy management", "PII protection", "compliance", "GDPR", "business rules"],
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

  return (
    <html
      lang={locale}
      // next-themes flips data-theme on the client before hydration so
      // a server/client mismatch on <html> is expected and benign.
      suppressHydrationWarning
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable}`}
    >
      <body className="antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider>
            <AuthProvider>{children}</AuthProvider>
            {/* Global toast outlet. Sonner is mounted once at locale-layout
                level so every page can call `toast.success()` / `toast.error()`
                without each owning its own ad-hoc banner state. */}
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{ className: 'font-sans' }}
            />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
