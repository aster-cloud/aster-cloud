/**
 * 「源码即诗」demo 页（公开）
 *
 * 演示关键词别名（ADR 0022）+ 无括号单参调用（ADR 0027）：一段 `.aster` 源码本身读起来就是
 * 一首诗，却仍由生产同款浏览器引擎逐字编译、递归执行。客户端纯静态 + 浏览器内 TS 引擎，
 * 即时可验、无网络——把「Aster 是真编译器，不是模板」讲成一个会动的故事。
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { PoemDemoContent } from './poem-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'poemDemoPage.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/demos/poem` },
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
    },
  };
}

export default async function PoemDemoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="bg-bg">
      <PoemDemoContent locale={locale} />
    </main>
  );
}
