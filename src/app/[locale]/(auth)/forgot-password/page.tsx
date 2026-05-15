/**
 * Forgot-password page — single email field → reset link.
 *
 * W2.2 rewrite: same /api/auth/forgot-password flow, design-system
 * visuals. Success state uses Alert (success variant) instead of a
 * bespoke green-tinted box.
 */
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardBody,
  Container,
  Input,
  Label,
  Stack,
  Wordmark,
} from '@/components/ui';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgotPassword');
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Something went wrong');
      }
      setIsSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-subtle py-12">
      <Container size="narrow">
        <Stack gap={8}>
          <Stack gap={6} align="center" className="text-center">
            <Link href="/" aria-label="Aster">
              <Wordmark variant="product" size="lg" />
            </Link>
            <Stack gap={2}>
              <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
                {isSubmitted ? t('successTitle') : t('title')}
              </h1>
              <p className="text-sm text-fg-muted">
                {isSubmitted ? t('successMessage') : t('subtitle')}
              </p>
            </Stack>
          </Stack>

          {isSubmitted ? (
            <>
              <Alert variant="success">
                <AlertTitle>{t('successTitle')}</AlertTitle>
                <AlertDescription>{t('successMessage')}</AlertDescription>
              </Alert>
              <p className="text-center">
                <Link
                  href="/login"
                  className="text-sm font-medium text-primary hover:text-primary-hover"
                >
                  {t('backToLogin')}
                </Link>
              </p>
            </>
          ) : (
            <Card>
              <CardBody className="pt-6">
                <form onSubmit={handleSubmit}>
                  <Stack gap={4}>
                    {error && (
                      <Alert variant="danger">
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}
                    <Stack gap={2}>
                      <Label htmlFor="email">{t('email')}</Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder={t('email')}
                      />
                    </Stack>
                    <Button type="submit" disabled={isLoading} className="w-full">
                      {isLoading ? t('sending') : t('sendResetLink')}
                    </Button>
                    <p className="text-center">
                      <Link
                        href="/login"
                        className="text-sm font-medium text-primary hover:text-primary-hover"
                      >
                        {t('backToLogin')}
                      </Link>
                    </p>
                  </Stack>
                </form>
              </CardBody>
            </Card>
          )}
        </Stack>
      </Container>
    </div>
  );
}
