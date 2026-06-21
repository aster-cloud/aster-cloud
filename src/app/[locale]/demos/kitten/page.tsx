/**
 * 🐱 猫咪心情引擎 fun-demo 页（公开彩蛋）
 *
 * 用撸猫领域词写一条诙谐诗意的规则，浏览器引擎注入猫词汇后真编译真执行，
 * 决策心情驱动一段 5 秒简笔猫动画。证明「领域词汇」可以是任何领域——哪怕是猫，
 * 底层和信贷 demo 同一套可证明引擎。纯客户端，无网络，即时。
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { CatMoodContent } from './cat-mood-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'catMoodPage.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/demos/kitten` },
    openGraph: { title: t('title'), description: t('description'), type: 'website' },
  };
}

export default async function CatMoodPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="bg-bg">
      <CatMoodContent locale={locale} />
    </main>
  );
}
