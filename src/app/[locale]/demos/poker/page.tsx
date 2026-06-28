/**
 * 🃏 德州扑克摊牌引擎 fun-demo 页（公开彩蛋，姊妹篇=猫咪心情引擎）
 *
 * 用扑克领域词写一条决定摊牌赢家的规则，浏览器引擎注入扑克词汇后真编译真执行，
 * 决策驱动牌桌动画——自动往复发牌、翻牌、判赢、给赢家颁奖杯。证明「领域词汇」可以是
 * 任何领域，底层和信贷 demo 同一套可证明引擎。纯客户端、无网络、即时。
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PokerContent } from './poker-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'pokerPage.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/demos/poker` },
    openGraph: { title: t('title'), description: t('description'), type: 'website' },
  };
}

export default async function PokerPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="bg-bg">
      <PokerContent locale={locale} />
    </main>
  );
}
