/**
 * LayoutMap —— 源码「显示排版」与「编译规范源码」解耦(移植自 aster-dev/aster-lang-ts examples)。
 *
 * Aster 的换行/缩进是语义性的(NEWLINE/INDENT/DEDENT 是块结构 token),不能让 parser 从
 * 「任意排版」反推结构。正确做法是「编译永远吃规范 Aster,显示层按映射渲染」——本模块即该映射。
 *
 * 一个 LayoutMap 由若干 span 组成,按 canonical 顺序排列:
 *   { text }               内容片段:canonical 与 display 都原样出现(诗词/歌词/结论)。
 *   { canonical, display } 结构片段:canonical 用规范值(如 '：'/换行缩进/关键词间空格),display 用
 *                          呈现值(可为 '' 隐藏——如把词间空格隐去,让 display 是无空格原诗)。
 *
 * 不变式:toCanonical(map) 就是编译用的唯一真源;display 仅供展示;编译永远走 canonical。
 * 防「显示欺骗」(看到的 ≠ 运行的)的真正防线是展示 canonical view + 语义测试,
 * verifyContentParity 只是一道轻量 lint(拦结构 span 偷塞字符串字面量),非安全边界。
 */

export type LayoutSpan = { text: string } | { canonical: string; display: string };

/** 由 spans 拼出编译用的规范源码。 */
export function toCanonical(spans: readonly LayoutSpan[]): string {
  return spans.map((s) => ('text' in s ? s.text : s.canonical)).join('');
}

/** 由 spans 拼出给用户看的显示排版。 */
export function toDisplay(spans: readonly LayoutSpan[]): string {
  return spans.map((s) => ('text' in s ? s.text : s.display)).join('');
}

/** 轻量 lint:至少有内容 span;结构 span 的 canonical 不夹带字符串字面量(须用内容 span)。 */
export function verifyContentParity(spans: readonly LayoutSpan[]): { ok: boolean; reason?: string } {
  const contentPieces = spans
    .filter((s): s is { text: string } => 'text' in s)
    .map((s) => s.text.trim())
    .filter(Boolean);
  for (const s of spans) {
    if ('canonical' in s && /["「」『』]/u.test(s.canonical)) {
      return {
        ok: false,
        reason: `结构 span 的 canonical 含字符串字面量(须用内容 span): ${JSON.stringify(s.canonical)}`,
      };
    }
  }
  if (contentPieces.length === 0) return { ok: false, reason: '无内容 span' };
  return { ok: true };
}
