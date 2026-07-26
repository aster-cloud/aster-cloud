/**
 * 「原创歌词即源码」demo 页（中文彩蛋）——《孤勇》
 *
 * 一段**原创**押韵短诗按词序即 `.aster` 源码：读起来像诗，却由生产同款浏览器 TS 引擎逐字真编译、
 * 真求值。末句触发词经**字面量宏**就地展开成一句押韵主题句，运行输出该句；三个原创触发词变体可切换。
 * LayoutMap 把语法脚手架隐进标点，页面显示工整押韵短诗、引擎编译带空格规范源码。
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
    description: '原创押韵短诗即源码——浏览器内真编译真求值，末句触发词经字面量宏就地展开成一句押韵主题句。',
    alternates: { canonical: `/${locale}/demos/guyong` },
    openGraph: {
      title: '孤勇 · 原创歌词即源码 · Aster Demo',
      description: '原创押韵短诗即源码——浏览器内真编译真求值，末句触发词经字面量宏就地展开成一句押韵主题句。',
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
