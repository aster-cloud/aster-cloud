'use client';

import { BookOpen, Lock, Sparkles, Zap } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Card, CardBody } from '@/components/ui';
import { CLIENT_CAPABILITIES } from '@/hooks/use-deployment-mode';

interface ProGateProps {
  /** True if the current plan is the result of a trial-just-ended downgrade. */
  trialExpired: boolean;
  /** When the trial ended, used in the explanatory copy. */
  trialEndsAt: string | null;
}

/**
 * Full lock-screen shown when the caller's plan blocks the feature.
 *
 * Distinguishes "you never had access" from "your trial just ended" so the
 * user can tell why the page is suddenly gated. CLIENT_CAPABILITIES.billing
 * switches the CTA between an in-app upgrade link (SaaS) and a contact-admin
 * fallback (on-prem).
 */
export function ProGate({ trialExpired, trialEndsAt }: ProGateProps) {
  const t = useTranslations('domainVocabularies.needsUpgrade');
  const locale = useLocale();

  const features = [
    { icon: BookOpen, key: 'featureCatalog' as const },
    { icon: Zap, key: 'featureBulk' as const },
    { icon: Sparkles, key: 'featureSnapshots' as const },
  ];

  const formattedTrialEnd =
    trialEndsAt !== null
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
          new Date(trialEndsAt),
        )
      : '';

  return (
    <Card>
      <CardBody className="flex flex-col items-center gap-6 px-6 py-12 text-center sm:px-12">
        <div className="rounded-full bg-primary-subtle p-4">
          <Lock className="h-8 w-8 text-primary" aria-hidden="true" />
        </div>

        <div className="max-w-xl space-y-2">
          <h2 className="font-display text-2xl font-semibold text-fg">
            {trialExpired ? t('trialEndedTitle') : t('title')}
          </h2>
          <p className="text-sm text-fg-muted">
            {trialExpired
              ? t('trialEndedDescription', { date: formattedTrialEnd })
              : t('description')}
          </p>
        </div>

        <ul className="grid w-full max-w-xl gap-3 text-left sm:grid-cols-3">
          {features.map(({ icon: Icon, key }) => (
            <li
              key={key}
              className="flex items-start gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2"
            >
              <Icon className="mt-0.5 h-4 w-4 text-primary" aria-hidden="true" />
              <span className="text-sm text-fg">{t(key)}</span>
            </li>
          ))}
        </ul>

        {CLIENT_CAPABILITIES.billing ? (
          <Link
            href="/billing"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-fg shadow-sm hover:bg-primary-hover"
          >
            {t('upgrade')}
          </Link>
        ) : (
          <span className="inline-flex items-center rounded-md bg-bg-subtle px-4 py-2 text-sm font-medium text-fg-muted">
            {t('contactAdmin')}
          </span>
        )}
      </CardBody>
    </Card>
  );
}

interface DowngradeBannerProps {
  /** True when the current plan is starter; bulk async is unavailable. */
  starterPlan: boolean;
  /** True when the user just crossed trial→free. */
  trialExpired: boolean;
  trialEndsAt: string | null;
}

/**
 * Inline informational banner shown above the list when the user retains
 * read/write but lost a sub-feature (e.g. starter → no async bulk, or trial
 * just ended into a partial feature set).
 */
export function DowngradeBanner({
  starterPlan,
  trialExpired,
  trialEndsAt,
}: DowngradeBannerProps) {
  const t = useTranslations('domainVocabularies.downgrade');
  const locale = useLocale();

  if (!starterPlan && !trialExpired) return null;

  const formattedTrialEnd =
    trialEndsAt !== null
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
          new Date(trialEndsAt),
        )
      : '';

  const title = trialExpired ? t('trialEndedTitle') : t('starterTitle');
  const description = trialExpired
    ? t('trialEndedDescription', { date: formattedTrialEnd })
    : t('starterDescription');

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-md border border-warning-subtle bg-warning-subtle px-4 py-3 text-warning"
    >
      <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex-1 text-sm">
        <p className="font-medium">{title}</p>
        <p className="mt-0.5 text-fg-muted">{description}</p>
      </div>
      {CLIENT_CAPABILITIES.billing ? (
        <Link
          href="/billing"
          className="shrink-0 text-sm font-medium text-warning underline-offset-2 hover:underline"
        >
          {t('cta')}
        </Link>
      ) : null}
    </div>
  );
}
