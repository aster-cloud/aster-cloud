/**
 * User settings — server shell + client islands.
 *
 * Server-rendered:
 *   - Title / subtitle
 *   - Setting cards layout + copy
 *   - Profile values pulled directly from session.user (no client-side
 *     useSession() round-trip, no first-paint "Not set" flicker)
 *   - Initial value of the locale-detection toggle, read from the
 *     server-side cookie so the switch never flips on-then-off after
 *     hydration
 *
 * Client islands (settings-client.tsx):
 *   - LocaleDetectionToggle  → cookie write + router.refresh()
 *   - SignOutButton          → next-auth signOut()
 *   - DeleteAccountFlow      → destructive confirm + DELETE call
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { defaultLocale } from '@/i18n/config';
import { getSession } from '@/lib/auth';
import {
  buttonVariants,
  Card,
  CardBody,
  Container,
  Stack,
  cn,
} from '@/components/ui';
import {
  LocaleDetectionToggle,
  SignOutButton,
  DeleteAccountFlow,
} from './settings-client';

const LOCALE_DETECTION_COOKIE = 'aster-locale-detection';

interface PageProps {
  params: Promise<{ locale: string }>;
}

export default async function SettingsPage({ params }: PageProps) {
  const { locale } = await params;
  const session = await getSession();
  if (!session?.user) {
    redirect(`/${locale}/login`);
  }

  const t = await getTranslations('settings');

  // Seed the toggle's initial state on the server so it doesn't flip
  // after hydration. Cookie absent ⇒ feature off (matches prior client
  // behavior).
  const cookieStore = await cookies();
  const localeDetection =
    cookieStore.get(LOCALE_DETECTION_COOKIE)?.value === 'true';

  const localePrefix = locale === defaultLocale ? '' : `/${locale}`;
  const logoutCallbackUrl = `${localePrefix}/`;

  const profileName = session.user.name || t('profile.notSet');
  const profileEmail = session.user.email || t('profile.notSet');
  // session.user.plan is a custom field stitched on by the NextAuth
  // callback; fall back to "Free" when the trial/seed user hasn't been
  // assigned a plan yet.
  const profilePlan = (session.user as { plan?: string }).plan || 'Free';

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

        {/* Language preferences (client toggle island) */}
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
                <LocaleDetectionToggle
                  initialChecked={localeDetection}
                  ariaLabel={t('language.autoDetect')}
                  enabledHint={t('language.enabled')}
                  disabledHint={t('language.disabled')}
                />
              </Stack>
            </Stack>
          </CardBody>
        </Card>

        {/* Profile fields — rendered fully on the server now. */}
        <Card>
          <CardBody className="pt-6">
            <Stack gap={4}>
              <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
                {t('profile.title')}
              </h2>
              <Stack gap={3}>
                <ProfileField label={t('profile.name')} value={profileName} />
                <ProfileField label={t('profile.email')} value={profileEmail} />
                <ProfileField label={t('profile.plan')} value={profilePlan} capitalize />
              </Stack>
            </Stack>
          </CardBody>
        </Card>

        {/* Account actions (sign out — client island) */}
        <SettingCard
          title={t('account.title')}
          subtitle={t('account.signOut')}
          description={t('account.signOutDesc')}
          action={
            <SignOutButton
              signOutLabel={t('account.signOut')}
              signingOutLabel={t('account.signingOut')}
              callbackUrl={logoutCallbackUrl}
            />
          }
        />

        {/* Danger zone — destructive flow lives in the client island. */}
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
                <DeleteAccountFlow
                  triggerLabel={t('dangerZone.deleteAccount')}
                  callbackUrl={logoutCallbackUrl}
                  labels={{
                    confirmTitle: t('dangerZone.confirmTitle'),
                    confirmMessage: t('dangerZone.confirmMessage'),
                    confirmItem1: t('dangerZone.confirmItem1'),
                    confirmItem2: t('dangerZone.confirmItem2'),
                    confirmItem3: t('dangerZone.confirmItem3'),
                    confirmDelete: t('dangerZone.confirmDelete'),
                    cancel: t('dangerZone.cancel'),
                    deleting: t('dangerZone.deleting'),
                  }}
                />
              </Stack>
            </Stack>
          </CardBody>
        </Card>
      </Stack>
    </Container>
  );
}

/* ------------------------------------------------------------------ */
/* SettingCard — server-rendered card with right-aligned action       */
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
