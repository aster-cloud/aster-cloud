/**
 * User settings page.
 *
 * W2.3 rewrite:
 *   - 4 setting cards (API keys link, language detection toggle, profile,
 *     account actions) each in a Card
 *   - "Danger zone" card uses a danger-tinted top border so it reads as
 *     destructive without being overpowered
 *   - Bespoke delete-confirmation modal replaced with ConfirmDialog
 *     (already in our ui/ as a separate, more accessible primitive)
 *   - Cookie I/O + session handling unchanged
 */
'use client';

import { useState, useEffect } from 'react';
import { useSession, signOut } from 'next-auth/react';
import { useTranslations, useLocale } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { defaultLocale } from '@/i18n/config';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Alert,
  AlertDescription,
  buttonVariants,
  Button,
  Card,
  CardBody,
  Container,
  Stack,
  cn,
} from '@/components/ui';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
  return match ? match[2] : null;
}

function setCookie(name: string, value: string, days = 365) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString();
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`;
}

export default function SettingsPage() {
  const t = useTranslations('settings');
  const locale = useLocale();
  const { data: session } = useSession();
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [localeDetection, setLocaleDetection] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Build locale-aware callback URL — default locale = no prefix.
  const localePrefix = locale === defaultLocale ? '' : `/${locale}`;
  const logoutCallbackUrl = `${localePrefix}/`;

  useEffect(() => {
    const saved = getCookie(LOCALE_DETECTION_COOKIE);
    if (saved !== null) {
      setLocaleDetection(saved === 'true');
    }
  }, []);

  const handleLocaleDetectionToggle = () => {
    const next = !localeDetection;
    setLocaleDetection(next);
    setCookie(LOCALE_DETECTION_COOKIE, String(next));
    // Hard reload: middleware reads the cookie on every request, this
    // ensures the toggle's effect lands immediately.
    window.location.reload();
  };

  const handleLogout = async () => {
    setIsLoggingOut(true);
    await signOut({ callbackUrl: logoutCallbackUrl });
  };

  const handleDeleteAccount = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      const response = await fetch('/api/user/delete', { method: 'DELETE' });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete account');
      }
      await signOut({ callbackUrl: logoutCallbackUrl });
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : 'Failed to delete account');
      setIsDeleting(false);
    }
  };

  return (
    <Container size="base" className="py-6 sm:py-10">
      <Stack gap={6}>
        <Stack gap={2}>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg">
            {t('title')}
          </h1>
          <p className="text-sm text-fg-muted">{t('subtitle')}</p>
        </Stack>

        {/* API Keys */}
        <SettingCard
          title={t('apiKeys.title')}
          description={t('apiKeys.subtitle')}
          action={
            <Link
              href="/settings/api-keys"
              className={buttonVariants({ variant: 'secondary', size: 'md' })}
            >
              {t('apiKeys.manageKeys')}
            </Link>
          }
        />

        {/* Language preferences (toggle) */}
        <Card>
          <CardBody className="pt-6">
            <Stack gap={4}>
              <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
                {t('language.title')}
              </h2>
              <Stack direction="row" justify="between" align="center" gap={4}>
                <Stack gap={1}>
                  <p className="text-sm font-medium text-fg">{t('language.autoDetect')}</p>
                  <p className="text-sm text-fg-muted">{t('language.autoDetectDesc')}</p>
                </Stack>
                <Toggle
                  checked={localeDetection}
                  onChange={handleLocaleDetectionToggle}
                  ariaLabel={t('language.autoDetect')}
                />
              </Stack>
              <p className="text-xs text-fg-subtle">
                {localeDetection ? t('language.enabled') : t('language.disabled')}
              </p>
            </Stack>
          </CardBody>
        </Card>

        {/* Profile fields (read-only display) */}
        <Card>
          <CardBody className="pt-6">
            <Stack gap={4}>
              <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
                {t('profile.title')}
              </h2>
              <Stack gap={3}>
                <ProfileField label={t('profile.name')} value={session?.user?.name || t('profile.notSet')} />
                <ProfileField label={t('profile.email')} value={session?.user?.email || t('profile.notSet')} />
                <ProfileField label={t('profile.plan')} value={session?.user?.plan || 'Free'} capitalize />
              </Stack>
            </Stack>
          </CardBody>
        </Card>

        {/* Account actions (sign out) */}
        <SettingCard
          title={t('account.title')}
          subtitle={t('account.signOut')}
          description={t('account.signOutDesc')}
          action={
            <Button
              type="button"
              variant="secondary"
              onClick={handleLogout}
              disabled={isLoggingOut}
            >
              {isLoggingOut ? t('account.signingOut') : t('account.signOut')}
            </Button>
          }
        />

        {/* Danger zone — rose-tinted border to telegraph destructive context */}
        <Card className="border-rose-200">
          <CardBody className="pt-6">
            <Stack gap={4}>
              <h2 className="font-display text-xl font-semibold tracking-tight text-danger">
                {t('dangerZone.title')}
              </h2>
              <Stack direction="row" justify="between" align="center" gap={4}>
                <Stack gap={1}>
                  <p className="text-sm font-medium text-fg">{t('dangerZone.deleteAccount')}</p>
                  <p className="text-sm text-fg-muted">{t('dangerZone.deleteAccountDesc')}</p>
                </Stack>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => setShowDeleteModal(true)}
                >
                  {t('dangerZone.deleteAccount')}
                </Button>
              </Stack>
            </Stack>
          </CardBody>
        </Card>
      </Stack>

      <ConfirmDialog
        isOpen={showDeleteModal}
        onCancel={() => !isDeleting && setShowDeleteModal(false)}
        onConfirm={handleDeleteAccount}
        title={t('dangerZone.confirmTitle')}
        description={
          <Stack gap={3}>
            <p>{t('dangerZone.confirmMessage')}</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-fg-muted">
              <li>{t('dangerZone.confirmItem1')}</li>
              <li>{t('dangerZone.confirmItem2')}</li>
              <li>{t('dangerZone.confirmItem3')}</li>
            </ul>
            {deleteError && (
              <Alert variant="danger">
                <AlertDescription>{deleteError}</AlertDescription>
              </Alert>
            )}
          </Stack>
        }
        confirmLabel={isDeleting ? t('dangerZone.deleting') : t('dangerZone.confirmDelete')}
        cancelLabel={t('dangerZone.cancel')}
        variant="danger"
        isLoading={isDeleting}
      />
    </Container>
  );
}

/* ------------------------------------------------------------------ */
/* SettingCard — header row + right-aligned action                     */
/* ------------------------------------------------------------------ */

interface SettingCardProps {
  title: string;
  subtitle?: string;
  description: string;
  action: React.ReactNode;
}

function SettingCard({ title, subtitle, description, action }: SettingCardProps) {
  return (
    <Card>
      <CardBody className="pt-6">
        <Stack direction="row" justify="between" align="center" gap={4} wrap>
          <Stack gap={1} className="min-w-0 flex-1">
            <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
              {title}
            </h2>
            {subtitle && (
              <p className="text-sm font-medium text-fg">{subtitle}</p>
            )}
            <p className="text-sm text-fg-muted">{description}</p>
          </Stack>
          <div className="shrink-0">{action}</div>
        </Stack>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* ProfileField — label above value                                    */
/* ------------------------------------------------------------------ */

function ProfileField({
  label, value, capitalize,
}: { label: string; value: string; capitalize?: boolean }) {
  return (
    <Stack gap={1}>
      <p className="text-sm font-medium text-fg-muted">{label}</p>
      <p className={cn('text-sm text-fg', capitalize && 'capitalize')}>{value}</p>
    </Stack>
  );
}

/* ------------------------------------------------------------------ */
/* Toggle — small switch styled to match the brand                     */
/* ------------------------------------------------------------------ */

interface ToggleProps {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}

function Toggle({ checked, onChange, ariaLabel }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-fast ease-standard',
        'focus-visible:outline-none focus-visible:shadow-ring',
        checked ? 'bg-primary' : 'bg-bg-muted',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none inline-block size-5 transform rounded-full bg-bg shadow ring-0',
          'transition-transform duration-fast ease-standard',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}
