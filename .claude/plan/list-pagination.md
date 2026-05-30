# 实施计划:策略与领域词汇的服务端分页

> 由 `/ccg:plan` 综合 codex(后端权威) + codex(前端权威) 分析生成。
> SESSION_ID 在文末,供 `/ccg:execute` 复用上下文。

---

## 0. 增强后的需求(供执行阶段参考)

为以下三个 Next.js 15 App Router 列表页引入**统一、可访问、URL-canonical** 的服务端分页:

1. **`/[locale]/(dashboard)/policies`** — 当前内联 `db.query.policies.findMany` 一次性取所有 policy,无分页 UI
2. **`/[locale]/(dashboard)/domain-vocabularies`** — 服务端 (`listUserVocabularyTerms`) 已返回 `{ items, total, page, pageSize, archivedCount }` 但 UI 写死 `page=1`
3. **`/[locale]/(dashboard)/domain-vocabularies/snapshots`** — 服务端 `listOwnerSnapshots` 一次性返回全部,无分页

### 验收标准(AC)

| ID | 描述 |
|---|---|
| AC1 | URL `?page=N&pageSize=K` 可被刷新/分享/Back 完整恢复 |
| AC2 | 翻页 / 切换 pageSize / 改 filter 都键盘可达,axe-core 通过 |
| AC3 | filter 变化时 page 自动重置为 1,且只发出一次请求(无竞态) |
| AC4 | out-of-range `?page=999` 时服务端 clamp 到最后一页,URL 通过 `replace` 规范化 |
| AC5 | 三页都用同一个 `Pagination` 原语 + 同一组 `pagination.*` i18n 键 |
| AC6 | en/zh/de 全部对齐(ICU 复数对 items 数生效) |
| AC7 | 无现有路由 500 回归;现有 bookmark(无 `?page`)落到第一页 |

---

## 1. 任务类型

- [x] **全栈**(前端 + 后端 + 设计系统原语 + i18n)
- 后端: codex 负责 service 层 + API 层(权威)
- 前端: codex 负责 `Pagination` 原语 + 三页 UI 接入(权威)
- 由 Claude 最终落地代码

---

## 2. 综合技术方案

### 2.1 设计系统:新增 `Pagination` 原语(应用层路径)

> **决策**:本期先放在 `src/components/ui/pagination.tsx`,加 `TODO: migrate to @aster-cloud/ui`。
> 原因:design system 单独发布周期重,本期目标是上线分页,迁移作为后续 PR。

**原语 API**:

```ts
export interface PaginationProps {
  page: number;          // 1-indexed
  pageSize: number;
  total: number;
  pageSizeOptions?: number[];      // default: [25, 50, 100]
  /** Builds the href for a given page; Pagination renders <Link>. */
  buildHref: (next: { page: number; pageSize: number }) => string;
  /** When true, calls onPageChange/onPageSizeChange instead of router.replace; for client-driven sub-views. */
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  /** "items" noun for the status line; defaults to localized generic. */
  itemNoun?: string;
  className?: string;
  /** When true, page numbers and prev/next are hidden but the status line + selector remain visible. */
  singlePage?: boolean;
}
```

**视觉规则**:
- desktop ≥ `sm`:`[Showing 51-100 of 234]    [‹ 1 ... 4 5 6 ... 10 ›]    [25 / page ▾]`
- mobile < `sm`:垂直堆叠 `status` → `‹ Page 5 of 10 ›` → `25 / page`
- 单页 (`totalPages ≤ 1`):隐藏 prev/next/页码,保留 status + selector
- `total === 0`:整个 footer 隐藏(列表的 EmptyState 负责沟通)
- active 页:`bg-primary text-primary-fg`;hover:`bg-bg-subtle`;disabled:`text-fg-subtle cursor-not-allowed`
- aria:外层 `<nav aria-label={t('pagination.label')}>`,当前页 `aria-current="page"`,prev/next disabled 时加 `aria-disabled="true"`
- 状态变化时触发 polite live region:`Page 3 of 10, showing 51-75 of 234 items`

### 2.2 URL 状态机:`createListSearchParams` 工具

> **决策**:抽一个 `src/lib/list-search-params.ts` 工具,统一解析 `searchParams` → 规范化对象,提供 `withPatch` 用于构建新 URL。所有列表页共用。

```ts
// 伪代码
export interface ListUrlState {
  page: number;
  pageSize: number;
  q?: string;
  // page-specific filters stored as-is
  filters: Record<string, string>;
}

export interface ListUrlOptions {
  defaultPageSize: number;
  allowedPageSizes: number[];
  filterKeys: readonly string[];   // e.g. ['domain', 'locale', 'kind']
}

export function parseListUrlState(
  searchParams: URLSearchParams | Record<string, string | string[] | undefined>,
  opts: ListUrlOptions,
): ListUrlState;

/**
 * Build the next URL string. Omits `page=1` and default pageSize for canonical form.
 * Filter changes always reset page to 1.
 */
export function buildListUrl(
  pathname: string,
  current: ListUrlState,
  patch: Partial<ListUrlState> & { resetPage?: boolean },
  opts: ListUrlOptions,
): string;
```

**关键规则**:
- 所有变化都用 `router.replace`(view-state refinement,不污染历史)
- `?page=1` 与默认 `pageSize` 从 URL 中**省略**(规范化)
- filter / search / pageSize 变化 → `resetPage: true`(原子化避免双请求)
- 解析时 `page` 非正整数 → 1;`pageSize` 不在 `allowedPageSizes` → default;不抛错

### 2.3 后端:三个 service 同形契约

> **决策**:所有 list service 返回 `{ items, total, page, pageSize }`。其余字段(如 `archivedCount`)按需追加但不破坏基础形状。

#### 2.3.1 新增 `src/lib/policies.ts`

将 `policies/page.tsx` 中的查询抽出:

```ts
export interface PolicyListEntry { /* id, name, group, freezeStatus, executionCount, ... */ }
export interface PolicyListResult {
  items: PolicyListEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export async function listUserPolicies(
  userId: string,
  opts: { page: number; pageSize: number; groupId?: string | null; q?: string },
): Promise<PolicyListResult>;

export async function listPolicyGroupsWithCounts(
  userId: string,
): Promise<PolicyGroupSidebarEntry[]>;   // 不分页,sidebar 全集
```

- **execution count** 仅对当前页的 `policyIds` 查 (避免全表 COUNT)
- **group count** sidebar 独立 + 不分页,但需加 ownerType/userId 过滤(原代码可能存在 leak,需顺手 audit)
- **索引**:`policies(userId, deletedAt, updatedAt DESC, id)`(若已存在则跳过)
- **总数**:用独立 `COUNT(*)` 查询,与 list 并行 `Promise.all`(Hyperdrive `max=1` 下实际是串行,但语义更清晰)

#### 2.3.2 `src/lib/domain-vocabulary-snapshot.ts:listOwnerSnapshots` 改造

```ts
export async function listOwnerSnapshots(
  userId: string,
  opts: { domain?: string; locale?: string; page?: number; pageSize?: number } = {},
): Promise<{ items: SnapshotListEntry[]; total: number; page: number; pageSize: number }>;
```

- **破坏性**:返回类型从 `SnapshotListEntry[]` 改为对象包装。需要扫 callers 全部更新(预计:`snapshots/page.tsx` + 任何 admin/test):
  ```
  grep -rn "listOwnerSnapshots" src/
  ```
- **排序**:从 `asc(createdAt)` 改为 `desc(createdAt)`(最新优先,分页时更合理)
- 现有调用方修改最小:`const { items: snapshots } = await listOwnerSnapshots(...)`

#### 2.3.3 `listUserVocabularyTerms` 无需改造

已返回正确形状。仅 `page.tsx` 需要读 `searchParams` 并透传。

#### 2.3.4 API 路由

- `GET /api/v1/domain-vocabularies/terms`:已支持 `?page=&pageSize=`,**不动**
- `GET /api/v1/domain-vocabularies/snapshots`:**新增** `?page=&pageSize=` 解析
- (policies 暂无客户端 fetch 路径,纯 SSR 翻页;若 vocab 客户端 search 改服务端,沿用现 API)

### 2.4 前端:三页统一接入

#### 2.4.1 `policies/page.tsx`

- 接 `searchParams: Promise<{ page?, pageSize?, group?, q? }>`
- 调用新 `listUserPolicies()` + `listPolicyGroupsWithCounts()`
- 传 `{ items, total, page, pageSize, groups, ... }` 到 client
- `policies-content.tsx` 在主列表卡片下方 sibling 渲染 `<Pagination />`,放在 `SharedWithMeSection` 之前
- 现有 client 端搜索改造为:URL `?q=` driven(`router.replace` debounce 300ms 提交)
- **out-of-range 处理**:server 计算 `totalPages`,若 `page > totalPages && total > 0`,在 page.tsx 中 `redirect(buildListUrl(pathname, {...current, page: totalPages}))`(注意:Server Component `redirect` 来自 `next/navigation`)

#### 2.4.2 `domain-vocabularies/page.tsx` + `vocabularies-content.tsx`

- `page.tsx` 接 `searchParams`,透传到 `listUserVocabularyTerms()`
- `vocabularies-content.tsx`:
  - **删除** 写死 `page=1` / `pageSize=50` 的 fetch 路径
  - filter (`domain/locale/kind`) 改 URL-driven:每次变化 `router.replace`,server re-render 自动重取
  - **简化**:删除现 client 端 `refetch` + `AbortController` 路径,统一走 RSC re-render
  - search (`query`):**改为服务端**,通过新 URL 参数 `?q=`,与 filters 一同 reset page
  - 渲染 `<Pagination buildHref={...} />` 在 DataTable 之下
- vocab 现有的 `archivedCount` 仍由 `listUserVocabularyTerms` 返回,作为额外 prop

#### 2.4.3 `snapshots/page.tsx` + `snapshots-content.tsx`

- `page.tsx` 接 `searchParams`,调用 `listOwnerSnapshots(userId, { page, pageSize })`
- `snapshots-content.tsx`:
  - 现 client 端 query/filter 改 URL-driven(domain/locale 可选;v1 只做 q)
  - DataTable 之下渲染 `<Pagination singlePage={totalPages <= 1} />`

### 2.5 i18n:新增共享 `pagination` 命名空间

```json
{
  "pagination": {
    "label": "Pagination",
    "previous": "Previous",
    "next": "Next",
    "page": "Page",
    "pageOf": "Page {page} of {totalPages}",
    "goToPage": "Go to page {page}",
    "showing": "Showing {start}-{end} of {total, plural, one {# item} other {# items}}",
    "showingEmpty": "No items",
    "itemsPerPage": "Items per page",
    "perPage": "{count} per page",
    "ellipsis": "More pages"
  }
}
```

- en / de / zh 三个 messages 文件同步,zh 不用复数但保留 ICU 占位结构
- 页面级 i18n 不重复 pagination 文案

---

## 3. 实施步骤(按 PR 切分,每步独立可合)

### PR-1 — Pagination 原语 + URL 工具 + i18n(必须先合)

**文件**:
| 文件 | 操作 | 说明 |
|---|---|---|
| `src/components/ui/pagination.tsx` | 新建 | Pagination 原语(含 NumberedDesktop / CompactMobile / Status / PageSizeSelect 子组件) |
| `src/components/ui/index.ts` | 修改 | 导出 `Pagination`, `PaginationProps` |
| `src/lib/list-search-params.ts` | 新建 | `parseListUrlState` + `buildListUrl` 工具 + 单元测试 |
| `src/lib/list-search-params.test.ts` | 新建 | 单元测试:边界 (page<1, pageSize 非法, default 省略) |
| `messages/en.json` `messages/zh.json` `messages/de.json` | 修改 | 新增 `pagination.*` |
| `src/components/ui/pagination.test.tsx`(可选) | 新建 | 渲染 + a11y 快照 |

**验收**:`pnpm typecheck && pnpm lint && pnpm vitest list-search-params` 通过。

### PR-2 — 词汇页接入分页(最低风险)

**理由**:后端 service 已就绪,改动最小,可作为原语试金石。

**文件**:
| 文件 | 操作 | 说明 |
|---|---|---|
| `src/app/[locale]/(dashboard)/domain-vocabularies/page.tsx` | 修改 | 接 `searchParams`,透传 page/pageSize/filters,clamp out-of-range |
| `src/app/[locale]/(dashboard)/domain-vocabularies/vocabularies-content.tsx` | 修改 | 删除 refetch/AbortController 路径;filter/search → `router.replace`;挂 `<Pagination />` |
| `src/lib/domain-vocabulary.ts:listUserVocabularyTerms` | 可能修改 | 接 `q` 参数(若引入服务端搜索)|
| `src/__tests__/integration/domain-vocabulary.integration.test.ts` | 修改 | 增加 page=2 / out-of-range / q 三个用例 |

**验收**:
- `tsc --noEmit`,`eslint` 0 报错
- 手测 `?page=2` 可恢复,filter 变化 reset 到 page=1,filter+page 同时改不竞态

### PR-3 — Snapshots 接入分页(中等风险:service 破坏性签名)

**文件**:
| 文件 | 操作 | 说明 |
|---|---|---|
| `src/lib/domain-vocabulary-snapshot.ts:listOwnerSnapshots` | 修改 | 改返回 `{ items, total, page, pageSize }`,排序改 desc |
| `src/app/api/v1/domain-vocabularies/snapshots/route.ts` | 修改 | 解析 `?page=&pageSize=` |
| `src/app/[locale]/(dashboard)/domain-vocabularies/snapshots/page.tsx` | 修改 | 接 `searchParams`,clamp |
| `src/app/[locale]/(dashboard)/domain-vocabularies/snapshots/snapshots-content.tsx` | 修改 | 接 `<Pagination />`,URL-driven q |
| 其它 caller(via grep) | 修改 | 解构 `.items` |
| `src/__tests__/integration/domain-vocabulary.integration.test.ts` | 修改 | 加 snapshots 分页用例 |

**验收**:同 PR-2 + 手测刷新 / Back / out-of-range 均正常。

### PR-4 — Policies 接入分页(最高风险:抽 service + 改主页面)

**文件**:
| 文件 | 操作 | 说明 |
|---|---|---|
| `src/lib/policies.ts` | 新建 | `listUserPolicies` + `listPolicyGroupsWithCounts`,从 page.tsx 抽出 |
| `src/app/[locale]/(dashboard)/policies/page.tsx` | 修改 | 接 `searchParams`,调 service,clamp;保留 freeze status 取数 |
| `src/app/[locale]/(dashboard)/policies/policies-content.tsx` | 修改 | 挂 `<Pagination />` 在主列表 + SharedWithMeSection 之间;search → URL `?q=`;group → URL `?group=` |
| `src/db/schema.ts` 索引(若缺) | 评估后增 | `CREATE INDEX CONCURRENTLY IF NOT EXISTS` migration |
| `src/__tests__/integration/policies.integration.test.ts`(新增或扩) | 新建/修改 | page=2、q、group filter 用例 |

**风险**:`policies-content.tsx` 当前包含拖放 / 多选 / 分组等复杂状态。分页应只影响"渲染哪些行",不影响"哪些行被选中/拖动"。**实施时检查**:
- 多选状态在翻页时如何保留?**建议**:翻页清空多选(配合 toast 提示),或保留 `selectedIds: Set<string>` 跨页持久(更复杂,本期不做)
- 拖放只在当前页内有效(本就如此)

**验收**:同上 + 手测拖放与翻页不互相破坏。

### PR-5(可选)— `/admin/issued-licenses` 接入 + 设计系统迁移 TODO

**理由**:三页接入后,顺势把 admin 列表也补齐,把原语标记可迁移。

---

## 4. 关键文件总览

| 文件 | 操作 | 影响范围 |
|---|---|---|
| `src/components/ui/pagination.tsx` | 新建 | 新原语 |
| `src/components/ui/index.ts` | 修改 | 导出 |
| `src/lib/list-search-params.ts` | 新建 | URL 工具 |
| `src/lib/list-search-params.test.ts` | 新建 | 单测 |
| `src/lib/policies.ts` | 新建 | 抽 service |
| `src/lib/domain-vocabulary-snapshot.ts` | 修改 | listOwnerSnapshots 签名 |
| `src/app/api/v1/domain-vocabularies/snapshots/route.ts` | 修改 | 解析 page/pageSize |
| `src/app/[locale]/(dashboard)/policies/page.tsx` | 修改 | searchParams + service |
| `src/app/[locale]/(dashboard)/policies/policies-content.tsx` | 修改 | URL-driven + Pagination |
| `src/app/[locale]/(dashboard)/domain-vocabularies/page.tsx` | 修改 | searchParams + clamp |
| `src/app/[locale]/(dashboard)/domain-vocabularies/vocabularies-content.tsx` | 修改 | 去 refetch loop + Pagination |
| `src/app/[locale]/(dashboard)/domain-vocabularies/snapshots/page.tsx` | 修改 | searchParams |
| `src/app/[locale]/(dashboard)/domain-vocabularies/snapshots/snapshots-content.tsx` | 修改 | Pagination |
| `messages/{en,zh,de}.json` | 修改 | `pagination.*` 命名空间 |
| `src/__tests__/integration/domain-vocabulary.integration.test.ts` | 修改 | page / clamp / q 用例 |
| `src/__tests__/integration/policies.integration.test.ts` | 新建/扩 | policies 分页用例 |

---

## 5. 风险与缓解

| 风险 | 严重度 | 缓解措施 |
|---|---|---|
| `listOwnerSnapshots` 破坏性签名漏掉 caller | 中 | 实施前 `grep -rn "listOwnerSnapshots" src/` 列全;TS 编译会兜底 |
| 现 vocabularies-content `refetch` 路径删除后 SSR 重渲染慢 | 中 | RSC 缓存默认 `dynamic = 'force-dynamic'` 即可;首页冷启已可接受 |
| policies 多选状态翻页丢失 | 低-中 | v1 选择"翻页清空多选" + i18n toast 提示,后续 PR 再做跨页持久 |
| Hyperdrive `max=1`,COUNT(*) 串行额外耗时 | 中 | 现 policies 全量加载本就慢,分页 + 索引后净收益正向;profiler 验证 |
| out-of-range redirect 死循环 | 高 | `redirect` 前断言 `totalPages >= 1`;`total === 0` 时不重定向,渲染空态 |
| filter + page 双 setter 引发 double fetch | 中 | 所有 URL 变化经 `buildListUrl({...current, ...patch, resetPage})` 单入口 |
| design system 重复模式偏离 | 低 | `src/components/ui/index.ts` 顶部加 TODO 标注待迁移到 `@aster-cloud/ui` |
| 现有 `archivedCount` 等额外字段被遗漏 | 低 | vocab service 不变只追加;page.tsx 透传 |
| `next/navigation` `redirect` 行为(throw redirect) | 低 | 文档化:`redirect` 必须在 try 之外,否则被 catch |

---

## 6. 开放问题(执行前必须确认或在 PR 中决议)

1. **vocab 端的 `q` 搜索改成服务端吗?** 建议:**是**(否则跨页搜索没意义)
2. **policies 多选翻页**保留 vs 清空? 建议:**v1 清空 + toast**
3. **policies 默认 pageSize**:20 还是 25? 建议:**25**(对齐可选项)
4. **pageSize 是否持久化** localStorage / cookie? 建议:**不持久化**(URL 即真相)
5. **PolicyVersion 一并分页吗?** 建议:**不在本期**(focused scope)
6. **snapshots 是否加 domain/locale filter**? 建议:**v1 仅 q,filter 留待后续**

---

## 7. SESSION_ID(供 `/ccg:execute` 复用)

- **CODEX_SESSION**(后端权威): `019e7939-7956-7f02-b835-c76ed615df3d`
- **GEMINI_SESSION**(前端权威): `019e7939-79ad-7230-ac21-8344f7ceb363`

> 备注:本仓库 `/ccg:plan` 实际两个调用都走的 codex backend(label "GEMINI_SESSION" 仅延续命名约定)。
