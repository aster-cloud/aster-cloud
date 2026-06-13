'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * AI 解释/建议输出的 Markdown 渲染器。
 *
 * 为什么需要：LLM 解释天然用 Markdown（标题、加粗、列表、字段表格）。此前前端用
 * `whitespace-pre-wrap` 当纯文本渲染 → 表格显示成生 `|...|` 管道符、`#` 标题不分级，
 * 阅读体验差（"用户不友好"）。这里用 react-markdown + remark-gfm（支持 GFM 表格）
 * 渲染成排版良好的内容，并用项目设计 token 上色，深浅色一致。
 *
 * 安全：react-markdown 默认**不**渲染原始 HTML（无 rehype-raw），用户/模型注入的
 * `<script>` 等被当作纯文本，天然 XSS-safe；CSP/Workers 友好（纯 JS，无 eval）。
 * 流式安全：内容增量更新时整体重渲染，Markdown 解析对半截文本鲁棒。
 */
export function AiMarkdown({ content }: { content: string }) {
  return (
    <div className="ai-markdown text-xs leading-relaxed text-fg dark:text-gray-200">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 标题：缩到与小字号面板协调的层级。
          h1: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold text-fg dark:text-gray-100">{children}</h4>,
          h2: ({ children }) => <h4 className="mt-3 mb-1.5 text-sm font-semibold text-fg dark:text-gray-100">{children}</h4>,
          h3: ({ children }) => <h5 className="mt-2.5 mb-1 text-xs font-semibold text-fg dark:text-gray-100">{children}</h5>,
          h4: ({ children }) => <h5 className="mt-2.5 mb-1 text-xs font-semibold text-fg dark:text-gray-100">{children}</h5>,
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-0.5 pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-0.5 pl-4">{children}</ol>,
          li: ({ children }) => <li className="marker:text-fg-subtle">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-fg dark:text-gray-100">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          // 行内代码 + 代码块。
          code: ({ className, children }) => {
            const isBlock = /language-/.test(className ?? '') || String(children).includes('\n');
            if (isBlock) {
              return (
                <code className="block overflow-x-auto rounded-md bg-zinc-900 p-2.5 font-mono text-[11px] leading-relaxed text-zinc-100">
                  {children}
                </code>
              );
            }
            return <code className="rounded bg-bg px-1 py-0.5 font-mono text-[11px] text-fg dark:bg-gray-900">{children}</code>;
          },
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          // GFM 表格：字段清单常用，给边框 + 表头底色，深浅色都清晰。
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-[11px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-bg dark:bg-gray-900">{children}</thead>,
          th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold dark:border-gray-700">{children}</th>,
          td: ({ children }) => <td className="border border-border px-2 py-1 align-top dark:border-gray-700">{children}</td>,
          a: ({ href, children }) => (
            <a href={href} className="text-primary underline-offset-2 hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="my-2 border-l-2 border-border pl-3 text-fg-muted dark:border-gray-700">{children}</blockquote>
          ),
          hr: () => <hr className="my-3 border-border dark:border-gray-700" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
