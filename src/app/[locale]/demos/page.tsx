/**
 * Demos 索引落地页（公开）。
 *
 * 把三个独立 demo（credit / kitten / vocab）聚合成一个卡片网格导航，作为统一入口。
 * landing footer 的单一「Demos」链接指向这里；各卡片进入对应 demo 子路由。
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Card, CardBody, Container, Stack } from '@/components/ui';
import { Link } from '@/i18n/navigation';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'demosIndex.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/demos` },
    openGraph: { title: t('title'), description: t('description'), type: 'website' },
  };
}

/** 三个 demo 的卡片元数据：href 指向子路由，文案走 i18n（demosIndex.cards.<key>）。 */
const DEMO_CARDS = [
  { key: 'credit', href: '/demos/credit', emoji: '📊' },
  { key: 'vocab', href: '/demos/vocab', emoji: '🏷️' },
  { key: 'kitten', href: '/demos/kitten', emoji: '🐱' },
] as const;

export default async function DemosIndexPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'demosIndex' });

  return (
    <main className="bg-bg">
      <Container className="py-12 sm:py-16">
        <Stack gap={2} className="mb-10 text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">{t('eyebrow')}</p>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-fg sm:text-4xl">
            {t('title')}
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-fg-muted">{t('subtitle')}</p>
        </Stack>

        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {DEMO_CARDS.map((card) => (
            <li key={card.key}>
              <Link href={card.href} className="block h-full focus:outline-none">
                <Card className="h-full transition-shadow hover:shadow-brand">
                  <CardBody className="flex h-full flex-col gap-3 pt-6">
                    <span className="text-3xl" aria-hidden>{card.emoji}</span>
                    <h2 className="font-display text-xl font-semibold tracking-tight text-fg">
                      {t(`cards.${card.key}.title`)}
                    </h2>
                    <p className="flex-1 text-sm text-fg-muted">{t(`cards.${card.key}.description`)}</p>
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                      {t('enter')}
                      <span aria-hidden>→</span>
                    </span>
                  </CardBody>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </main>
  );
}
