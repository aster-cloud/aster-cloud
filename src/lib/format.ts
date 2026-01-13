/**
 * 格式化日期字符串
 * 使用明确的 locale 和格式选项，确保服务端和客户端输出一致
 * 避免 React hydration error #418
 */
export function formatDate(dateString: string | Date, locale: string): string {
  const date = typeof dateString === 'string' ? new Date(dateString) : dateString;
  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}
