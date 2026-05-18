/**
 * Signup page client component — OAuth-only entry point (no email/password yet).
 *
 * W2.2 rewrite: same flow (NextAuth signIn → /onboarding callback),
 * design-system visuals. Trial benefits panel uses the accent-tinted
 * card pattern (primary-subtle bg) to read as "value summary" not
 * "warning".
 *
 * 服务端 page.tsx 用 CAN_SIGNUP 守门（on-prem 模式下 notFound）。本组件
 * 假设进入时已经是 SaaS 模式，不做重复检查。
 */
'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useTranslations, useLocale } from 'next-intl';
import { Check } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { defaultLocale } from '@/i18n/config';
import {
  Button,
  Card,
  CardBody,
  Stack,
  Wordmark,
} from '@/components/ui';

export function SignupContent() {
  const t = useTranslations('auth.signup');
  const locale = useLocale();
  const [isLoading, setIsLoading] = useState(false);

  // Locale-aware callback URL: defaultLocale = no prefix; others get /<locale>.
  const localePrefix = locale === defaultLocale ? '' : `/${locale}`;
  const callbackUrl = `${localePrefix}/onboarding`;

  const handleOAuthSignIn = (provider: string) => {
    setIsLoading(true);
    signIn(provider, { callbackUrl });
  };

  const trialFeatures = [
    t('trialFeatures.executions'),
    t('trialFeatures.pii'),
    t('trialFeatures.compliance'),
    t('trialFeatures.api'),
    t('trialFeatures.support'),
  ];

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle px-4 py-12 sm:px-6">
      {/* 注册页与登录页保持一致的 max-w-md (28rem / 448px) 锚定；
          OAuth-only 入口本身只有 2-3 个按钮，更宽的容器只会让卡片显得空。 */}
      <div className="mx-auto w-full max-w-md">
        <Stack gap={8}>
          <Stack gap={6} align="center" className="text-center">
            <Link href="/" aria-label="Aster">
              <Wordmark variant="product" size="lg" />
            </Link>
            <Stack gap={2}>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
                {t('title')}
              </h1>
              <p className="text-sm text-fg-muted">{t('subtitle')}</p>
            </Stack>
          </Stack>

          {/* Trial benefits — primary-subtle card so it reads as a value
              summary, not an alert. The dashed-look approach (border with
              alpha) was tried and felt scrappy; tinted-card is cleaner. */}
          <Card className="bg-primary-subtle border-primary/20">
            <CardBody className="py-5">
              <Stack gap={3}>
                <p className="text-sm font-semibold text-primary">
                  {t('trialIncludes')}
                </p>
                <ul className="space-y-2">
                  {trialFeatures.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-sm text-fg">
                      <Check className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </Stack>
            </CardBody>
          </Card>

          {/* OAuth providers (signup-style — full-width buttons, label on the right) */}
          <Stack gap={3}>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOAuthSignIn('github')}
              disabled={isLoading}
              className="w-full"
            >
              <GitHubIcon className="size-4" />
              <span>{t('continueWithGithub')}</span>
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => handleOAuthSignIn('google')}
              disabled={isLoading}
              className="w-full"
            >
              <GoogleIcon className="size-4" />
              <span>{t('continueWithGoogle')}</span>
            </Button>
          </Stack>

          {/* Legal + sign-in link */}
          <Stack gap={4} align="center" className="text-center">
            <p className="text-xs text-fg-subtle">
              {t('termsAgreement')}{' '}
              <Link href="/terms" className="text-primary hover:text-primary-hover">
                {t('termsOfService')}
              </Link>{' '}
              {t('and')}{' '}
              <Link href="/privacy" className="text-primary hover:text-primary-hover">
                {t('privacyPolicy')}
              </Link>
            </p>
            <p className="text-sm text-fg-muted">
              {t('alreadyHaveAccount')}{' '}
              <Link
                href="/login"
                className="font-medium text-primary hover:text-primary-hover"
              >
                {t('signIn')}
              </Link>
            </p>
          </Stack>
        </Stack>
      </div>
    </div>
  );
}

/* Provider marks — duplicated from login-content.tsx for now. If a third
 * auth surface needs them, lift to src/components/auth/oauth-icons.tsx. */

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24" aria-hidden>
      <path
        fillRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  );
}
