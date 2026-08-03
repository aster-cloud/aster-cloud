/**
 * 站内助手的检索核心（纯函数，无 React / 无网络 / 无 DB）。
 *
 * <p><b>这不是联网 AI 聊天</b>：不调任何 LLM、不出站、不读用户数据。它把用户的
 * 自然语言问句映射到**站内已有的两类事实源**：
 * <ul>
 *   <li>文档索引 —— 复用 {@link searchDocs}（三语，75 篇，标题/描述/小节加权）</li>
 *   <li>导航与快捷动作 —— 复用命令面板的 {@link Command} 列表</li>
 * </ul>
 * 因此答案永远可点击溯源，不存在幻觉编造。
 *
 * <p>抽成纯函数是为了能脱离 DOM 逐条断言排序与边界（见 retrieval.test.ts）。
 */

import { searchDocs, type SearchIndex } from '@/lib/docs/search-runtime';
import type { Command } from '@/components/dashboard/command-palette-commands';

/** 一条可点击的检索结果。 */
export interface AssistantHit {
  /** 稳定去重键。 */
  id: string;
  kind: 'doc' | 'action';
  title: string;
  /** 文档为 description；动作为所属分组名。 */
  subtitle?: string;
  href: string;
  /** 越大越靠前（仅同一次调用内可比）。 */
  score: number;
}

export interface RetrieveOptions {
  /** 文档索引（按当前 locale 预加载）。 */
  docsIndex: SearchIndex;
  /** 命令面板的导航/动作列表。 */
  commands: readonly Command[];
  /**
   * 文档路由前缀（en 为 ''，其余为 `/<locale>`）。
   *
   * <p>★索引里的 slug 是**相对**的（`api/policies/versions`），直接当 href 用会
   * 相对当前路径解析成 `/zh/docs/getting-started/api/...` 这种 404。
   * 与 DocsCommandPalette 的 buildHref 同口径。
   */
  docsPrefix: string;
  /** 返回条数上限。 */
  limit?: number;
}

/** 文档命中的基准分（searchDocs 的分层分数已足够区分，这里只做跨源归一）。 */
const DOC_BASE = 1;
/** 动作命中的分层：完整短语 > 标签前缀 > 关键词命中。 */
const ACTION_EXACT = 1200;
const ACTION_PREFIX = 800;
const ACTION_KEYWORD = 600;

/** 归一：小写 + 去首尾空白（中文无大小写，保持原样即可）。 */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

/**
 * 给导航/动作打分。
 *
 * <p>中文查询没有空格分词，故**同时**用整串匹配与按空白切分的 token 匹配——
 * 只按空白切会让「新建策略」这种连写查询完全命中不到。
 */
function scoreCommand(cmd: Command, query: string): number | null {
  const q = norm(query);
  if (!q) return null;

  const label = norm(cmd.label);
  const haystack = [label, ...(cmd.keywords ?? []).map(norm)];

  // 整串：完全相等 > 前缀 > 包含
  for (const h of haystack) {
    if (h === q) return ACTION_EXACT;
  }
  for (const h of haystack) {
    if (h.startsWith(q)) return ACTION_PREFIX;
  }
  for (const h of haystack) {
    if (h.includes(q)) return ACTION_KEYWORD;
  }

  // 空格分词：任一 token 命中即算（英文/德文多词查询）
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    const hit = tokens.some((t) => haystack.some((h) => h.includes(t)));
    if (hit) return ACTION_KEYWORD - 100;
  }
  return null;
}

/**
 * 执行检索。空查询返回空数组（调用方据此显示引导语而非空列表）。
 *
 * <p>排序：先按分数降序；同分时**文档优先于动作**——用户问「怎么…」时
 * 说明性文档比跳转按钮更可能是想要的答案。最后按 id 稳定排序，
 * 保证同一查询每次结果顺序一致（避免 UI 抖动）。
 */
export function retrieve(query: string, opts: RetrieveOptions): AssistantHit[] {
  const q = query.trim();
  if (!q) return [];

  const limit = opts.limit ?? 8;
  const hits: AssistantHit[] = [];

  for (const hit of searchDocs(q, opts.docsIndex, { limit: limit * 2 })) {
    hits.push({
      id: `doc:${hit.entry.slug}`,
      kind: 'doc',
      title: hit.entry.title || hit.entry.slug,
      subtitle: hit.entry.description || undefined,
      href: `${opts.docsPrefix}/docs/${hit.entry.slug}`,
      score: hit.score * DOC_BASE,
    });
  }

  for (const cmd of opts.commands) {
    const score = scoreCommand(cmd, q);
    if (score === null) continue;
    hits.push({
      id: `action:${cmd.id}`,
      kind: 'action',
      title: cmd.label,
      subtitle: cmd.group,
      href: cmd.href,
      score,
    });
  }

  hits.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.kind !== b.kind) return a.kind === 'doc' ? -1 : 1;
    return a.id.localeCompare(b.id);
  });

  return hits.slice(0, limit);
}
