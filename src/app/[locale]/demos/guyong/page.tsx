/**
 * 「原创歌词即源码」demo 页（中文彩蛋）——《孤勇》
 *
 * 一段**原创**叙事体歌词按词序即 `.aster` 源码：读起来像歌，却由生产同款浏览器 TS 引擎逐字真编译、
 * 真裁决。三个「信物」当前提，引擎用字符串比较逐一确定真值再合成，如果/否则真判定输出裁决。
 * LayoutMap 让页面显示无空格流动歌词、引擎编译带空格规范源码。客户端纯静态 + 浏览器内引擎，即时可验。
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
    description: '原创叙事体歌词即源码——浏览器内真编译真裁决，三信物即前提，引擎真推导出归途或坠落。',
    alternates: { canonical: `/${locale}/demos/guyong` },
    openGraph: {
      title: '孤勇 · 原创歌词即源码 · Aster Demo',
      description: '原创叙事体歌词即源码——浏览器内真编译真裁决，三信物即前提，引擎真推导出归途或坠落。',
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
