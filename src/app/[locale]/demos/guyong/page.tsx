/**
 * 「原创歌词即源码」demo 页（中文彩蛋）——《孤勇》
 *
 * 一段**原创**叙事体歌词按词序即 `.aster` 源码：读起来像歌，却由生产同款浏览器 TS 引擎逐字真编译、
 * 真裁决。五个布尔前提（守/进/记/灯/岸）由 toggle 传 true/false，引擎以 并且 合成 归心，
 * 如果/否则真判定输出裁决。LayoutMap 把语法脚手架隐进标点，页面显示有意境中文、引擎编译带空格规范源码。
 * 客户端纯静态 + 浏览器内引擎，即时可验。
 */
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { GuyongDemoContent } from './guyong-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: '孤勇 · 原创歌词即源码 · Aster Demo',
    description: '原创叙事体歌词即源码——浏览器内真编译真裁决，五个布尔前提，引擎真推导出归途或坠落。',
    alternates: { canonical: `/${locale}/demos/guyong` },
    openGraph: {
      title: '孤勇 · 原创歌词即源码 · Aster Demo',
      description: '原创叙事体歌词即源码——浏览器内真编译真裁决，五个布尔前提，引擎真推导出归途或坠落。',
      type: 'website',
    },
  };
}

export default async function GuyongDemoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="bg-bg">
      <GuyongDemoContent />
    </main>
  );
}
