'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { docsSidebar } from '@/lib/docs/sidebar';
import { useDocsOverlay } from './docs-overlay-context';
import { useDocContent } from './use-doc-content';
import { useDocSearch } from './use-doc-search';
import { X, ExternalLink, BookText, Search } from 'lucide-react';
import { Link } from '@/i18n/navigation';

/**
 * 登录后「文档」overlay：覆盖在 dashboard-main 上的三栏阅读面板（不跳转）。
 *
 *   左:  目录（复用 docsSidebar 树，点项切内容）
 *   中:  当前文档正文（fetch /docs HTML 剥 .docs-article 注入，淡入切换）
 *   右:  本页 TOC（从注入内容扫 h2/h3 生成，点击锚点滚动）
 *   右上角: 关闭按钮
 *
 * 可访问性：role=dialog aria-modal、Esc 关、蒙层点击关、body 滚动锁、focus 进面板、
 * 关闭焦点回触发按钮（由 sidebar 入口负责）、100dvh、reduced-motion 去动效。
 */
export function DocsOverlay() {
  const t = useTranslations();
  const { open, slug, navigate, close } = useDocsOverlay();
  const { html, toc, loading, error } = useDocContent(slug, open);
  const [query, setQuery] = useState('');
  const { results } = useDocSearch(query);
  const searching = query.trim().length > 0;
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const articleRef = useRef<HTMLDivElement>(null);

  // 选中某文档（目录项或搜索结果）→ 切内容 + 清空搜索回到目录视图
  function selectDoc(next: string) {
    navigate(next);
    setQuery('');
  }

  // body 滚动锁 + Esc 关 + 焦点进关闭按钮 + Tab focus-trap（限制在面板内）
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key === 'Tab' && panelRef.current) {
        const focusable = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const activeEl = document.activeElement;
        if (e.shiftKey && activeEl === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && activeEl === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // 切页后把正文滚回顶部
  useEffect(() => {
    if (articleRef.current) articleRef.current.scrollTop = 0;
  }, [html]);

  if (!open) return null;

  function scrollToHeading(id: string) {
    const el = articleRef.current?.querySelector(`#${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <div
      className="fixed inset-y-0 right-0 z-20 transition-[left] duration-200 ease-out"
      style={{ left: 'var(--aster-shell-pad-left, 0px)' }}
      role="dialog"
      aria-modal="true"
      aria-label={t('dashboardNav.docs')}
    >
      {/* 只覆盖内容区（dashboard-main 范围）——left 偏移跟随 sidebar 宽度
          （--aster-shell-pad-left），桌面左侧 sidebar 仍可见可用。z-20 低于
          sidebar(md:z-30) 与移动端汉堡/抽屉(z-40/z-50)，确保它们始终在 overlay 之上。 */}
      <div
        className="absolute inset-0 bg-zinc-950/40 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in"
        onClick={close}
        aria-hidden="true"
      />

      {/* 面板：填满内容区，留出小边给蒙层 */}
      <div
        ref={panelRef}
        className="absolute inset-2 sm:inset-4 flex flex-col overflow-hidden rounded-xl border border-border bg-bg shadow-2xl motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95"
      >
        {/* 顶栏：标题 + 在 /docs 打开 + 关闭 */}
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
          <span className="flex items-center gap-2 font-display text-sm font-semibold text-fg">
            <BookText className="h-4 w-4 text-fg-muted" />
            {t('dashboardNav.docs')}
          </span>
          <div className="flex items-center gap-1">
            <Link
              href={`/docs/${slug}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('docs.overlay.openFull')}
            </Link>
            <button
              ref={closeRef}
              type="button"
              onClick={close}
              aria-label={t('docs.overlay.close')}
              className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-muted hover:text-fg"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* 三栏主体 */}
        <div className="flex min-h-0 flex-1">
          {/* 左：搜索 + 目录（搜索时用结果替换目录树） */}
          <nav
            aria-label={t('docs.overlay.contents')}
            className="hidden w-60 shrink-0 flex-col overflow-hidden border-r border-border md:flex"
          >
            {/* 搜索框 */}
            <div className="shrink-0 border-b border-border p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('docs.overlay.searchPlaceholder')}
                  aria-label={t('docs.overlay.searchPlaceholder')}
                  className="w-full rounded-md border border-border bg-bg-soft py-1.5 pl-8 pr-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {searching ? (
              /* 搜索结果列表（点结果在 overlay 内切页） */
              results.length > 0 ? (
                <ul className="space-y-0.5">
                  {results.map((hit) => (
                    <li key={hit.entry.slug}>
                      <button
                        type="button"
                        onClick={() => selectDoc(hit.entry.slug)}
                        className="block w-full rounded-md px-3 py-2 text-left text-sm text-fg-muted transition-colors hover:bg-bg-soft hover:text-fg"
                      >
                        <span className="block truncate font-medium text-fg">{hit.entry.title}</span>
                        <span className="block truncate text-xs text-fg-muted">{hit.entry.slug}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2 text-sm text-fg-muted">{t('docs.overlay.noResults')}</p>
              )
            ) : (
              docsSidebar.map((section) => (
              <div key={section.titleKey} className="mb-6">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                  {t(section.titleKey)}
                </h2>
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = slug === item.href;
                    return (
                      <li key={item.href}>
                        <button
                          type="button"
                          onClick={() => navigate(item.href)}
                          aria-current={isActive ? 'page' : undefined}
                          className={
                            'block w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors ' +
                            (isActive
                              ? 'bg-bg-soft font-medium text-fg'
                              : 'text-fg-muted hover:bg-bg-soft hover:text-fg')
                          }
                        >
                          {t(item.labelKey)}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
              ))
            )}
            </div>
          </nav>

          {/* 中：正文（注入 + 淡入） */}
          <div ref={articleRef} className="min-w-0 flex-1 overflow-y-auto px-4 py-8 sm:px-8">
            {error ? (
              <div className="mx-auto max-w-3xl text-sm text-fg-muted">
                {t('docs.overlay.loadError')}{' '}
                <Link href={`/docs/${slug}`} className="text-primary underline">
                  {t('docs.overlay.openFull')}
                </Link>
              </div>
            ) : (
              <article
                key={slug}
                aria-busy={loading}
                className={
                  'docs-article prose prose-zinc dark:prose-invert mx-auto max-w-3xl ' +
                  'transition-opacity duration-200 motion-reduce:transition-none ' +
                  (loading ? 'opacity-40' : 'opacity-100')
                }
                dangerouslySetInnerHTML={{ __html: html }}
              />
            )}
          </div>

          {/* 右：本页 TOC */}
          {toc.length > 0 && (
            <nav
              aria-label={t('docs.toc.title')}
              className="hidden w-56 shrink-0 overflow-y-auto border-l border-border p-4 xl:block"
            >
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-fg-muted">
                {t('docs.toc.title')}
              </h2>
              <ul className="space-y-1">
                {toc.map((item) => (
                  <li key={item.id} className={item.level === 3 ? 'pl-3' : ''}>
                    <button
                      type="button"
                      onClick={() => scrollToHeading(item.id)}
                      className="block w-full truncate text-left text-sm text-fg-muted transition-colors hover:text-fg"
                    >
                      {item.text}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          )}
        </div>
      </div>
    </div>
  );
}
