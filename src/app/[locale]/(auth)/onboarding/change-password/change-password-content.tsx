'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { extractErrorMessage } from '@/lib/api/error-envelope';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardBody,
  CardDescription,
  CardHeader,
  CardTitle,
  Container,
  Input,
  Label,
  Stack,
  toast,
} from '@/components/ui';

/**
 * First-login forced password rotation form.
 *
 * Submits to /api/user/change-password with both the temporary
 * password (currentPassword) and the new one. Backend re-verifies
 * the current password before flipping mustChangePassword=false.
 *
 * Why current-password re-verification even on forced rotation:
 * the session cookie alone is enough to call this endpoint, so an
 * attacker who hijacks a session shouldn't get to set a permanent
 * password. The user must know the temporary the operator handed
 * them.
 */
export function ChangePasswordContent({ email }: { email: string }) {
  const t = useTranslations('changePassword');
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError(t('errorTooShort'));
      return;
    }
    if (newPassword !== confirmPassword) {
      setError(t('errorMismatch'));
      return;
    }
    if (newPassword === currentPassword) {
      setError(t('errorSame'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(extractErrorMessage(data) || t('errorGeneric'));
        return;
      }
      toast.success(t('success'));
      router.replace('/dashboard');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container size="narrow" className="py-12">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('subtitle', { email })}</CardDescription>
        </CardHeader>
        <CardBody>
          <form onSubmit={submit} className="space-y-4">
            <Stack gap={2}>
              <Label htmlFor="cp-current">{t('currentLabel')}</Label>
              <Input
                id="cp-current"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="cp-new">{t('newLabel')}</Label>
              <Input
                id="cp-new"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
              <p className="text-xs text-fg-muted">{t('newHint')}</p>
            </Stack>
            <Stack gap={2}>
              <Label htmlFor="cp-confirm">{t('confirmLabel')}</Label>
              <Input
                id="cp-confirm"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
              />
            </Stack>

            {error && (
              <Alert variant="danger">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button type="submit" variant="primary" disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </Button>
          </form>
        </CardBody>
      </Card>
    </Container>
  );
}
