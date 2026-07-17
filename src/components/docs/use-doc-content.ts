'use client';

import { useEffect, useState } from 'react';
import { useLocale } from 'next-intl';
import { getPathname } from '@/i18n/navigation';
import type { Locale } from '@/i18n/config';

export type TocItem = { id: string; text: string; level: 2 | 3 };

type DocContent = {
  html: string;
  toc: TocItem[];
  loading: boolean;
  error: boolean;
};

/**
 * 抓取 /docs/<slug> 页面 HTML，剥离出 <article class="docs-article"> 正文注入
 * overlay。内容来自同源、构建期编译的 MDX（非用户输入），但仍做安全收紧：
 * - 只 fetch 同源 /<locale>/docs/<slug>（slug 来自 docsSidebar 白名单，不接受外部输入）
 * - 移除 <script>/<style> 与所有 on* 事件属性（防注入页若被篡改时的纵深防御）
 * - 给每个 h2/h3 补 id（用于 TOC 锚点跳转），并抽出 TOC 列表
 *
 * docs 正文几乎全是静态 prose + 构建期 shiki 高亮，注入静态 HTML 不损失交互；
 * 个别带 client 交互的块在 overlay 内失效，由「在 /docs 打开完整版」兜底。
 */
export function useDocContent(slug: string, active: boolean): DocContent {
  const locale = useLocale();
  const [state, setState] = useState<DocContent>({
    html: '',
    toc: [],
    loading: false,
    error: false,
  });

  useEffect(() => {
    if (!active || !slug) return;
    let cancelled = false;
    // 依赖（slug/active/locale）变化时发起 fetch 并置 loading——从外部条件同步
    // 加载态，非无条件每次渲染置位。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState((s) => ({ ...s, loading: true, error: false }));

    // ★用 getPathname 构造 URL（尊重 localePrefix:'as-needed'）★：默认 locale en
    // 的规范路径**不带** /en 前缀（/docs/...），非默认 locale 带（/zh/docs/...）。
    // 此前硬编码 `/${locale}/docs/...` 对 en 产出 /en/docs/... 会触发到规范路径的
    // 重定向，浏览器 fetch 经中间件时表现不一致 → 中间区「Could not load」。
    //
    // 不加自定义请求头：会让同源 fetch 变「非简单请求」可能触发 preflight 或被边缘拦。
    // credentials:same-origin 带会话 cookie（force-dynamic docs + 中间件 CSP nonce）。
    const url = getPathname({ href: `/docs/${slug}`, locale: locale as Locale });
    fetch(url, { credentials: 'same-origin', redirect: 'follow' })
      .then((res) => {
        if (!res.ok) throw new Error(`docs fetch ${res.status} for ${url}`);
        return res.text();
      })
      .then((raw) => {
        if (cancelled) return;
        const doc = new DOMParser().parseFromString(raw, 'text/html');
        const article = doc.querySelector('.docs-article');
        if (!article) {
          // 诊断：拿到了 HTML 但没 .docs-article（被重定向到 login？locale 前缀错？）
          throw new Error(
            `no .docs-article in ${url} (len=${raw.length}, title=${doc.title})`,
          );
        }

        // 纵深防御：去脚本/样式/内联事件（同源构建产物，正常不含，但不信任）
        // 纵深防御（内容是同源构建期 MDX，非用户输入，风险本就低，但不信任注入的 HTML）：
        // 1) 删可执行/可加载外部资源的元素
        article
          .querySelectorAll('script, style, link, iframe, object, embed, form, base, meta')
          .forEach((el) => el.remove());
        // 2) 删内联事件 + 危险 URL scheme（javascript:/data: 的 href/src/xlink:href）
        const DANGEROUS_SCHEME = /^\s*(javascript|data|vbscript):/i;
        article.querySelectorAll('*').forEach((el) => {
          for (const attr of Array.from(el.attributes)) {
            const name = attr.name.toLowerCase();
            if (name.startsWith('on')) {
              el.removeAttribute(attr.name);
            } else if (
              (name === 'href' || name === 'src' || name === 'xlink:href' || name === 'formaction') &&
              DANGEROUS_SCHEME.test(attr.value)
            ) {
              el.removeAttribute(attr.name);
            }
          }
        });

        // 为 h2/h3 补 id + 抽 TOC
        const toc: TocItem[] = [];
        let n = 0;
        article.querySelectorAll('h2, h3').forEach((h) => {
          const level = (h.tagName === 'H2' ? 2 : 3) as 2 | 3;
          const text = (h.textContent || '').trim();
          if (!text) return;
          let id = h.getAttribute('id');
          if (!id) {
            id = `doc-h-${n}`;
            h.setAttribute('id', id);
          }
          n += 1;
          toc.push({ id, text, level });
        });

        setState({ html: article.innerHTML, toc, loading: false, error: false });
      })
      .catch((err) => {
        if (cancelled) return;
        // 打印真实失败原因到 console（诊断 overlay 中间「Could not load」）。
        console.error('[docs-overlay] failed to load', url, err);
        setState({ html: '', toc: [], loading: false, error: true });
      });

    return () => {
      cancelled = true;
    };
  }, [slug, active, locale]);

  return state;
}
