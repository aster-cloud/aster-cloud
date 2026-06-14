/**
 * 领域词汇 demo 页（公开）
 *
 * 演示「用你行业自己的术语写规则，引擎照样编译执行」卖点：选领域（医疗/保险/物流）→
 * 看用行业术语写的规则 + 术语表 → 选案例运行 → 浏览器引擎注入领域词汇后编译执行出决策。
 * 客户端纯静态 + 浏览器内 TS 引擎语义可验，即时、无网络、客户面前不翻车（销售弹药）。
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { VocabDemoContent } from './vocab-demo-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'vocabDemoPage.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/vocab-demo` },
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
    },
  };
}

export default async function VocabDemoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="bg-bg">
      <VocabDemoContent />
    </main>
  );
}
