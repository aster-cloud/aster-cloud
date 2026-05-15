/**
 * Landing page — public marketing surface.
 *
 * W2.2 rewrite goals:
 *   - Token-driven (no raw indigo/purple/blue utilities)
 *   - Fraunces for display headings, Inter for body
 *   - Composed from @/components/ui primitives so the visual identity
 *     stays locked to the design system
 *   - All i18n keys, plan logic, Stripe currency mapping preserved
 *
 * Structure (unchanged from W1.5):
 *   1. Fixed nav (wordmark + lang switcher + sign-in + CTA)
 *   2. Hero (display headline + sub + CTA)
 *   3. Features grid (6 cards, semantic-colored icon tiles)
 *   4. Pricing preview (3-tier, Pro highlighted)
 *   5. Bottom CTA (full-bleed violet section)
 *   6. Footer
 *
 * The 6 feature icon tiles use *semantic role* colors instead of the
 * old rainbow indigo/green/purple/yellow/red/blue palette. The intent
 * stays the same (visual variety so cards don't read as a uniform
 * block) but every tile pulls from the token system — replacing the
 * brand later is then a token edit, not a 6× color find-replace.
 */
import { useTranslations } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import {
  Languages,
  ShieldCheck,
  Sparkles,
  Zap,
  GlobeLock,
  Server,
  Check,
  Cpu,
  FileLock,
  GlobeIcon,
} from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { LanguageSwitcher } from '@/components/language-switcher';
import {
  buttonVariants,
  Card,
  CardHeader,
  CardBody,
  Container,
  Stack,
  Wordmark,
  cn,
} from '@/components/ui';
import { CnlDemo } from '@/components/marketing/cnl-demo';
import {
  getCurrencyForLocale,
  formatPrice,
  getProPrice,
  PLANS,
} from '@/lib/plans';

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function Home({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return <HomeContent locale={locale} />;
}

function HomeContent({ locale }: { locale: string }) {
  const t = useTranslations();
  const currency = getCurrencyForLocale(locale);
  const proMonthlyPrice = formatPrice(getProPrice(currency, 'monthly'), currency);

  return (
    <div className="flex min-h-screen flex-col bg-bg text-fg">
      <Nav t={t} />
      <Hero t={t} />
      <TrustBand t={t} />
      <Features t={t} />
      <PricingPreview
        t={t}
        currency={currency}
        proMonthlyPrice={proMonthlyPrice}
      />
      <BottomCta t={t} />
      <Footer t={t} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navigation                                                          */
/* ------------------------------------------------------------------ */

function Nav({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <nav
      className={cn(
        'fixed inset-x-0 top-0 z-20',
        'border-b border-border bg-bg/80 backdrop-blur-md',
      )}
    >
      <Container size="xl">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" aria-label={t('nav.brand')}>
            <Wordmark variant="product" size="md" />
          </Link>
          <Stack direction="row" gap={4} align="center">
            <LanguageSwitcher />
            <Link
              href="/login"
              className="text-sm font-medium text-fg-muted transition-colors hover:text-fg"
            >
              {t('common.signIn')}
            </Link>
            {/* Link rendered with Button visuals via buttonVariants().
                We don't use Button-wraps-Link because that nests
                interactive elements (invalid HTML + a11y violation). */}
            <Link
              href="/signup"
              className={buttonVariants({ variant: 'primary', size: 'md' })}
            >
              {t('common.startFreeTrial')}
            </Link>
          </Stack>
        </div>
      </Container>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* Hero                                                                */
/* ------------------------------------------------------------------ */

function Hero({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <section className="relative overflow-hidden pt-32 pb-24">
      {/* Decorative gradient — kept very subtle so it doesn't fight the
          editorial weight of the Fraunces headline. */}
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 -z-10 h-[40rem]',
          'bg-[radial-gradient(ellipse_60%_50%_at_50%_0%,var(--aster-color-violet-100),transparent_60%)]',
        )}
      />
      <Container size="xl">
        <Stack gap={6} align="center" className="text-center">
          <h1 className={cn(
            'font-display font-semibold tracking-tighter text-fg',
            // Step the headline size down a notch at the widest breakpoints
            // so `hero.title` + `hero.titleHighlight` fit on a single line
            // on desktop. Mobile keeps the larger leading for readability.
            'text-4xl leading-[1.1] sm:text-5xl md:text-6xl lg:text-7xl',
            'max-w-5xl',
          )}>
            {t('hero.title')}{' '}
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
              {t('hero.titleHighlight')}
            </span>
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-fg-muted sm:text-xl">
            {t('hero.description')}
          </p>
          <Stack direction="row" gap={3} className="mt-2">
            <Link
              href="/signup"
              className={buttonVariants({ variant: 'primary', size: 'lg' })}
            >
              {t('common.getStarted')}
            </Link>
          </Stack>
          <p className="text-xs text-fg-subtle">{t('hero.noCreditCard')}</p>

          {/* Live CNL demo — typewriter cycles three real, compilable
              snippets. The whole pitch of Aster is "policies written by
              humans, run as code" — show it, don't just say it. */}
          <div className="mt-10 w-full">
            <CnlDemo />
          </div>
        </Stack>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Trust band                                                          */
/* ------------------------------------------------------------------ */

/**
 * 3-column strip directly under the hero that anchors the page on
 * *real* product facts. The fact that we don't have customer logos yet
 * is OK — what we DO have is unusual in policy-DSL space (GraalVM
 * compilation, hash-chain audit, native trilingual support) and that's
 * what the band advertises.
 *
 * The 3 items map 1:1 to keys under `trust.items` in messages/*.json so
 * copy edits are i18n-driven, no hard-coded English.
 */
function TrustBand({ t }: { t: ReturnType<typeof useTranslations> }) {
  const items = [
    { icon: Cpu,       key: 'compiled'  },
    { icon: FileLock,  key: 'audited'   },
    { icon: GlobeIcon, key: 'multilang' },
  ] as const;

  return (
    <section className="border-y border-border bg-bg-subtle py-14">
      <Container size="xl">
        <Stack gap={8}>
          <p className="text-center font-sans text-xs font-semibold uppercase tracking-widest text-primary">
            {t('trust.eyebrow')}
          </p>
          <div className="grid gap-8 sm:grid-cols-3 sm:gap-10">
            {items.map(({ icon: Icon, key }) => (
              <Stack key={key} gap={3} align="center" className="text-center">
                <span
                  aria-hidden
                  className="flex size-11 items-center justify-center rounded-lg bg-primary-subtle text-primary"
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="font-display text-lg font-semibold tracking-tight text-fg">
                  {t(`trust.items.${key}.title`)}
                </h3>
                <p className="text-sm leading-relaxed text-fg-muted">
                  {t(`trust.items.${key}.description`)}
                </p>
              </Stack>
            ))}
          </div>
        </Stack>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Features                                                            */
/* ------------------------------------------------------------------ */

type FeatureTone = 'primary' | 'success' | 'accent' | 'warning' | 'danger' | 'neutral';

interface FeatureDef {
  icon: React.ComponentType<{ className?: string }>;
  tone: FeatureTone;
  titleKey: string;
  descKey: string;
}

/** Tone → tailwind utility map. Centralized so the rainbow stays
 *  on-brand: every shade is a token, no raw hex/utility values. */
const TONE_BG: Record<FeatureTone, string> = {
  primary: 'bg-primary-subtle text-primary',
  success: 'bg-success-subtle text-success',
  accent:  'bg-accent-subtle text-accent',
  warning: 'bg-warning-subtle text-warning',
  danger:  'bg-danger-subtle text-danger',
  neutral: 'bg-bg-muted text-fg-muted',
};

const FEATURES: readonly FeatureDef[] = [
  { icon: Languages,   tone: 'primary', titleKey: 'features.nativeLanguage.title',     descKey: 'features.nativeLanguage.description' },
  { icon: Sparkles,    tone: 'accent',  titleKey: 'features.aiDraftHumanReview.title', descKey: 'features.aiDraftHumanReview.description' },
  { icon: ShieldCheck, tone: 'success', titleKey: 'features.hashChainAudit.title',     descKey: 'features.hashChainAudit.description' },
  { icon: Zap,         tone: 'warning', titleKey: 'features.dualEngineSemantics.title', descKey: 'features.dualEngineSemantics.description' },
  { icon: GlobeLock,   tone: 'danger',  titleKey: 'features.multiLanguagePacks.title', descKey: 'features.multiLanguagePacks.description' },
  { icon: Server,      tone: 'neutral', titleKey: 'features.selfHostable.title',       descKey: 'features.selfHostable.description' },
] as const;

function Features({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <section className="bg-bg-subtle py-20">
      <Container size="xl">
        <Stack gap={12} align="center">
          <h2 className="font-display text-4xl font-semibold tracking-tight text-fg text-center">
            {t('features.title')}
          </h2>
          <div className="grid w-full gap-6 md:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map(({ icon: Icon, tone, titleKey, descKey }) => (
              <Card key={titleKey} className="transition-shadow duration-medium ease-standard hover:shadow-md">
                <CardBody className="pt-6">
                  <Stack gap={4}>
                    <div className={cn(
                      'flex size-12 items-center justify-center rounded-lg',
                      TONE_BG[tone],
                    )}>
                      <Icon className="size-6" aria-hidden />
                    </div>
                    <Stack gap={2}>
                      <h3 className="font-display text-xl font-semibold tracking-tight text-fg">
                        {t(titleKey)}
                      </h3>
                      <p className="text-sm leading-relaxed text-fg-muted">
                        {t(descKey)}
                      </p>
                    </Stack>
                  </Stack>
                </CardBody>
              </Card>
            ))}
          </div>
        </Stack>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Pricing preview                                                     */
/* ------------------------------------------------------------------ */

function PricingPreview({
  t, currency, proMonthlyPrice,
}: {
  t: ReturnType<typeof useTranslations>;
  currency: ReturnType<typeof getCurrencyForLocale>;
  proMonthlyPrice: string;
}) {
  return (
    <section className="py-20">
      <Container size="xl">
        <Stack gap={12} align="center">
          <Stack gap={3} align="center" className="text-center">
            <h2 className="font-display text-4xl font-semibold tracking-tight text-fg">
              {t('pricing.title')}
            </h2>
            <p className="max-w-xl text-fg-muted">{t('pricing.subtitle')}</p>
          </Stack>
          <div className="grid w-full max-w-5xl gap-6 md:grid-cols-3">
            {/* Free */}
            <PricingCard
              t={t}
              label={t('billing.plans.names.free')}
              price={formatPrice(0, currency)}
              perMonthLabel={t('pricing.perMonth')}
              features={PLANS.free.featureKeys}
              cta={{ href: '/signup', label: t('common.getStarted'), variant: 'outline' }}
            />
            {/* Pro — highlighted */}
            <PricingCard
              t={t}
              label={t('billing.plans.names.pro')}
              price={proMonthlyPrice}
              perMonthLabel={t('pricing.perMonth')}
              features={PLANS.pro.featureKeys}
              cta={{ href: '/signup', label: t('common.startFreeTrial'), variant: 'primary' }}
              highlight={t('billing.mostPopular')}
            />
            {/* Enterprise */}
            <PricingCard
              t={t}
              label={t('billing.plans.names.enterprise')}
              price={t('common.contactSales')}
              priceIsLabel
              features={PLANS.enterprise.featureKeys}
              cta={{ href: 'mailto:sales@aster-lang.cloud', label: t('common.contactSales'), variant: 'outline', external: true }}
            />
          </div>
        </Stack>
      </Container>
    </section>
  );
}

interface PricingCardProps {
  t: ReturnType<typeof useTranslations>;
  label: string;
  price: string;
  perMonthLabel?: string;
  /** When true, render the price slot as a single label instead of "price + /month". */
  priceIsLabel?: boolean;
  features: readonly string[];
  highlight?: string;
  cta: {
    href: string;
    label: string;
    variant: 'primary' | 'outline';
    external?: boolean;
  };
}

function PricingCard({
  t, label, price, perMonthLabel, priceIsLabel,
  features, highlight, cta,
}: PricingCardProps) {
  return (
    <Card className={cn(
      'relative flex flex-col',
      highlight && 'border-2 border-primary shadow-lg shadow-primary/10',
    )}>
      {highlight && (
        <span className={cn(
          'absolute -top-3 left-1/2 -translate-x-1/2',
          'rounded-full bg-primary text-primary-fg',
          'px-3 py-1 text-xs font-semibold',
        )}>
          {highlight}
        </span>
      )}
      <CardHeader>
        <p className="text-sm font-semibold uppercase tracking-wide text-fg-muted">
          {label}
        </p>
        {priceIsLabel ? (
          <p className="font-display text-2xl font-semibold tracking-tight text-fg">
            {price}
          </p>
        ) : (
          <p className="flex items-baseline gap-1">
            <span className="font-display text-4xl font-semibold tracking-tight text-fg">
              {price}
            </span>
            {perMonthLabel && (
              <span className="text-sm text-fg-muted">{perMonthLabel}</span>
            )}
          </p>
        )}
      </CardHeader>
      <CardBody className="flex flex-1 flex-col gap-6">
        <ul className="space-y-3 text-sm text-fg-muted">
          {features.map((featureKey) => (
            <li key={featureKey} className="flex items-start gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
              <span>{t(`billing.plans.features.${featureKey}`)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-2">
          {cta.external ? (
            <a
              href={cta.href}
              className={buttonVariants({ variant: cta.variant, size: 'md', className: 'w-full' })}
            >
              {cta.label}
            </a>
          ) : (
            <Link
              href={cta.href}
              className={buttonVariants({ variant: cta.variant, size: 'md', className: 'w-full' })}
            >
              {cta.label}
            </Link>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Bottom CTA                                                          */
/* ------------------------------------------------------------------ */

function BottomCta({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <section className="relative overflow-hidden bg-primary py-20 text-primary-fg">
      {/* Subtle radial highlight to keep the dense violet from feeling flat. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_60%_60%_at_50%_50%,rgb(255_255_255/0.08),transparent_70%)]"
      />
      <Container size="base" className="relative">
        <Stack gap={6} align="center" className="text-center">
          <h2 className="font-display text-4xl font-semibold tracking-tight">
            {t('cta.title')}
          </h2>
          <p className="max-w-xl text-lg leading-relaxed text-violet-100">
            {t('cta.description')}
          </p>
          <Link
            href="/signup"
            className={buttonVariants({ variant: 'secondary', size: 'lg' })}
          >
            {t('common.startFreeTrial')}
          </Link>
        </Stack>
      </Container>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

function Footer({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <footer className="mt-auto bg-zinc-900 py-12 text-zinc-400">
      <Container size="xl">
        <Stack gap={8}>
          <Stack direction="row" justify="between" align="center" wrap gap={6}>
            {/* Inline wordmark for the footer specifically. The shared
                <Wordmark> component hard-codes its two halves to text-fg
                + text-primary, which both come from light-mode brand
                tokens and end up nearly invisible against bg-zinc-900.
                Re-render the two spans here with dark-surface-safe
                colors (white + violet-300) instead of fighting class
                specificity with [&_span] overrides. */}
            <span
              aria-label="Aster Cloud"
              role="img"
              className="inline-flex select-none items-baseline gap-1.5"
            >
              <span
                aria-hidden
                className="font-display text-2xl font-semibold tracking-tightest text-white"
              >
                Aster
              </span>
              <span
                aria-hidden
                className="font-mono text-base font-normal tracking-tight text-violet-300"
              >
                cloud
              </span>
            </span>
            <Stack direction="row" gap={6} wrap>
              <FooterLink href="/privacy">{t('footer.privacy')}</FooterLink>
              <FooterLink href="/terms">{t('footer.terms')}</FooterLink>
              <FooterLink href="https://aster-lang.dev/" external>
                {t('footer.documentation')}
              </FooterLink>
              <FooterLink href="mailto:support@aster-lang.cloud" external>
                {t('footer.support')}
              </FooterLink>
            </Stack>
          </Stack>
          <p className="text-center text-xs text-zinc-500">
            © {new Date().getFullYear()} {t('nav.brand')}. {t('footer.copyright')}
          </p>
        </Stack>
      </Container>
    </footer>
  );
}

function FooterLink({
  href, external, children,
}: { href: string; external?: boolean; children: React.ReactNode }) {
  const className = 'text-sm transition-colors hover:text-white';
  return external ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {children}
    </a>
  ) : (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
