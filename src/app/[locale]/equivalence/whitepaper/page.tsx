/**
 * 双引擎等价白皮书专用页（/equivalence/whitepaper）。
 *
 * 面向风控/合规的可读长文 + 「下载 PDF」按钮（浏览器 window.print() + print CSS）。
 * 内容三语本地化（en/zh/de），与 /demo 的三语一致性原则统一。SEO 标题/描述取
 * whitepaper.meta，canonical 指向本路由。
 */
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { WhitepaperContent } from '@/components/whitepaper/whitepaper-content';
import { getWhitepaper } from '@/config/whitepaper';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const w = getWhitepaper(locale);
  return {
    title: w.meta.title,
    description: w.meta.subtitle,
    alternates: { canonical: `/${locale}/equivalence/whitepaper` },
    openGraph: {
      title: w.meta.title,
      description: w.meta.subtitle,
      type: 'article',
    },
  };
}

export default async function WhitepaperPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main>
      <WhitepaperContent locale={locale} />
    </main>
  );
}
