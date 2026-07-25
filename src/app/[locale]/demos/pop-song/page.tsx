/**
 * 「流行歌曲即源码」demo 页(中文彩蛋)
 *
 * 周杰伦歌名/歌词即 `.aster` 源码:读起来像歌,却由生产同款浏览器 TS 引擎逐字真编译、真裁决,
 * 决策驱动一幅程序化 SVG 周杰伦简笔画。客户端纯静态 + 浏览器内引擎,即时可验、无网络。
 */
import type { Metadata } from 'next';
import { setRequestLocale } from 'next-intl/server';
import { PopSongDemoContent } from './pop-song-content';

type Props = {
  params: Promise<{ locale: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return {
    title: '流行歌曲即源码 · Aster Demo',
    description: '周杰伦歌名即前提,源码即歌——浏览器内真编译真裁决,决策驱动一幅程序化简笔画。',
    alternates: { canonical: `/${locale}/demos/pop-song` },
    openGraph: {
      title: '流行歌曲即源码 · Aster Demo',
      description: '周杰伦歌名即前提,源码即歌——浏览器内真编译真裁决,决策驱动一幅程序化简笔画。',
      type: 'website',
    },
  };
}

export default async function PopSongDemoPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale);
  return (
    <main className="bg-bg">
      <PopSongDemoContent />
    </main>
  );
}
