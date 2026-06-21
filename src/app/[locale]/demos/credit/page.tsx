/**
 * 信贷风控 PoC demo 页（公开）
 *
 * 端到端演示「决策回放」杀手卖点：真实信贷准入规则 → 选样例申请人 →
 * 决策结果 → 回放这一笔决策（逐步给审计员看）。客户端纯静态渲染，
 * 规则用浏览器内 TS 引擎语义可验，回放用为场景手制的真实 DecisionTrace，
 * 即时、无网络、在客户面前不翻车（销售弹药）。
 */
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { DemoContent } from './demo-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'demoPage.seo' });
  return {
    title: t('title'),
    description: t('description'),
    alternates: { canonical: `/${locale}/demos/credit` },
    openGraph: {
      title: t('title'),
      description: t('description'),
      type: 'website',
    },
  };
}

export default async function DemoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="bg-bg">
      <DemoContent locale={locale} />
    </main>
  );
}
