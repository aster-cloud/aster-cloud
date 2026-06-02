# Cloud Docs Subsite — `aster-lang.cloud/docs/*`

**状态**：Phase 1 (foundation) 设计中
**owner**：Ryan
**关联仓库**：aster-cloud (this), aster-lang-dev (consumer)
**触发**：把 `aster-lang.dev` 误放的应用层 API 文档（21 个 REST/GraphQL/WS + 16 个 getting-started）从语言文档站迁回应用文档站

---

## 1. 目标与范围

### 必须达到

- `https://aster-lang.cloud/docs/api/policies/evaluate` 等 21 个 API 页面 200 + 渲染 + 三语 locale 切换
- `https://aster-lang.cloud/docs/getting-started/quickstart` 等 16 个入门页面同样可访问
- 与 aster-cloud 主站共享同一套：i18n（next-intl）、字体（Inter/Fraunces）、token 系统（`@aster-cloud/tokens`）、dark mode、auth-aware 导航
- 跨站从 `aster-lang.dev/api/policies/evaluate` → `aster-lang.cloud/docs/api/policies/evaluate` 跳转无中断

### 显式不做

- ❌ 不引入 contentlayer / velite / content-collections —— Next 16 + OpenNext 上这些方案的稳定性未验证
- ❌ 不做"docs-only 子域名"方案（`docs.aster-lang.cloud`）—— 用户已选 A1
- ❌ 不做 Cloudflare Workers Router 分流（保持单 Worker 单 deploy）
- ❌ 不做 search（Algolia / Pagefind）—— 留 Phase 2
- ❌ 不做版本化（v1 / v2 docs）—— 留 Phase 2
- ❌ 不复用 aster-lang-dev 的 VitePress 组件 —— 重写为 React/Tailwind 与主站一致

---

## 2. 技术约束（来自现状调研）

| 约束 | 来源 | 影响 |
|---|---|---|
| Next.js 16.2.6 + webpack | `package.json:scripts.dev` | 必须用 webpack-compatible MDX loader（`@next/mdx` 主线支持）|
| OpenNext + Cloudflare Workers（不是 Pages） | `wrangler.toml`、`open-next.config.ts` | MDX 的 build-time 编译必须发生在 next build 阶段，不能 runtime 编译（Worker 无 fs / 无 Node child_process）|
| next-intl 已配 | `src/i18n/{config,routing,request}.ts` | docs 路由必须挂在 `[locale]` segment 下 |
| Smart Placement = Melbourne | `wrangler.toml:[placement]` | 静态 docs 页应尽量 SSG，避免每请求 Worker CPU 消耗 |
| 没有 MDX deps | `package.json` | 全部要新装 |
| 自定义 `worker.js` wrapper | 顶层 worker.js | 不能动它，docs 路由通过常规 Next route 系统进来 |
| `serverExternalPackages` 已列了 monaco | `next.config.ts` | MDX runtime 不能引入大依赖 |

---

## 3. 架构决策

### 3.1 路由形状

```
src/app/[locale]/docs/
├── layout.tsx                        ← docs 通用 chrome: top nav + sidebar + footer
├── page.tsx                          ← /docs/ 入口（重定向到 /docs/getting-started/overview）
├── api/
│   ├── policies/
│   │   ├── evaluate/page.mdx
│   │   ├── evaluate-source/page.mdx
│   │   ├── ... (9 个)
│   ├── workflows/
│   │   ├── events/page.mdx
│   │   ├── ... (3 个)
│   ├── audit/
│   │   ├── ... (5 个)
│   ├── graphql/
│   │   ├── ... (3 个)
│   └── websocket/
│       └── preview/page.mdx
└── getting-started/
    ├── overview/page.mdx
    ├── authentication/page.mdx
    ├── quickstart/page.mdx
    └── errors/page.mdx
```

**关键决定**：用 **静态路由** + **每 locale 一份 `page.mdx`**（不是 catch-all + content collection）。

**理由**：
- Next 16 `@next/mdx` 原生支持 `page.mdx`，零额外构建步骤
- 静态路由 = build-time 自动生成静态 HTML，命中 Smart Placement 缓存
- 文件结构与 URL 1:1 映射，新增/重命名页面直接动文件
- 不需要写 sidebar generator —— 配置文件手维护（37 页 × 3 locale = 111 个 MDX 文件，sidebar 是 1 个 ts 配置文件）

**代价**：
- 每页 × 3 locale = 文件数 ×3。共 37 × 3 = **111 个 MDX 文件**
- locale 之间内容同步需要靠 PR review，没有 fallback 机制（next-intl 的 deep-merge 不适用于 MDX 内容）
- mitigated by: locale-parity CI 检查脚本（仿 `scripts/check-locales.ts`），每页 frontmatter 带 `lastReviewed: zh: <sha>` 跟踪

### 3.2 MDX pipeline

| 层 | 选型 | 备注 |
|---|---|---|
| 编译器 | `@next/mdx` ^16 | Next 16 官方包，webpack/turbopack 双轨；零额外 Vite/Rollup |
| Frontmatter | `remark-frontmatter` + `remark-mdx-frontmatter` | 把 YAML frontmatter 导出为 ES module 常量（用于 layout 拿 title/description） |
| Code highlight | `rehype-pretty-code` + Shiki `monokai-pro`/`github-light` | 与 aster-lang-dev 的 VitePress Shiki 一致（dark/light 双主题） |
| 链接处理 | `remark-gfm` | 表格、任务列表、autolink |
| Heading anchors | `rehype-slug` + `rehype-autolink-headings` | 与主站 token 集成（hover 出 § 锚点） |
| 不引入 | ❌ MDX server components、❌ JSX in MDX 业务组件 | 保持纯文档；自定义组件仅限 `<Callout>`, `<CodeGroup>`, `<ApiBadge>` |

### 3.3 i18n 路由

- 利用 next-intl 现有 `[locale]` segment + `localePrefix: 'as-needed'`：
  - EN（默认 locale）URL 为 `/docs/...`（不带前缀）
  - zh：`/zh/docs/...`，de：`/de/docs/...`
  - 这是 aster-cloud 全站统一策略（见 `src/i18n/navigation.ts`），不为 docs 特殊化
- `i18n/config.ts` 已有 `locales = ['en', 'zh', 'de']`，无需改
- docs sidebar 文案通过 `messages/{en,zh,de}.json` 的 `docs.sidebar.*` key 翻译（MDX 内容本身是文件级翻译）
- locale 切换：保持当前路径，仅替换前缀（next-intl Link 默认行为）

### 3.4 Sidebar / Layout

- 文件 `src/lib/docs/sidebar.ts` 维护层级结构（mirror 自 aster-lang-dev 的 `apiSidebar`）
- `src/app/[locale]/docs/layout.tsx` 组合：top nav（沿用主站）+ left sidebar（docs 专用） + content（MDX）+ right TOC（自动从 h2/h3 提取）
- Dark mode：复用主站的 `next-themes` 配置
- 字体：复用主站 `@aster-cloud/tokens` 的 Inter/Fraunces

### 3.5 OpenNext / Cloudflare 兼容

- 所有 `page.mdx` 在 build 阶段编译为静态 RSC payload —— Worker runtime 只 serve 静态文件
- `rehype-pretty-code` 的 Shiki 编译发生在 build-time，不进 Worker bundle
- `output: standalone` + `outputFileTracingRoot` 已配 —— 不变
- 不引入需要 fs 的 plugin（如本地图片处理）

### 3.6 跨站 redirect 协调

- aster-lang-dev `docs/public/_redirects` 在 Phase 2 改为 308 → `https://aster-lang.cloud/{locale?}/docs/...`
- URL 形状（`as-needed` 策略，EN 不带前缀）：
  - EN: `https://aster-lang.cloud/docs/api/policies/evaluate`
  - zh: `https://aster-lang.cloud/zh/docs/api/policies/evaluate`
  - de: `https://aster-lang.cloud/de/docs/api/policies/evaluate`
- 映射策略：
  - `/api/*` → `https://aster-lang.cloud/docs/api/:splat`（EN 无前缀）
  - `/zh/api/*` → `https://aster-lang.cloud/zh/docs/api/:splat`（aster-lang.dev 实际没这条，留 defensive）
  - `/de/api/*` → `https://aster-lang.cloud/de/docs/api/:splat`
  - `/getting-started/*` → `https://aster-lang.cloud/docs/getting-started/:splat`

---

## 4. 分阶段执行（multi-session）

### Session 1（今天）— Foundation PR

1. 装 MDX 依赖到 aster-cloud（dev only）
2. 配 `next.config.ts` 的 MDX loader + extensions
3. 建 `src/app/[locale]/docs/page.tsx` + `layout.tsx` + 1 个示例 MDX 页（`docs/example/page.mdx`）
4. 验 `pnpm build`（含 OpenNext build）通过
5. 验 3 个 locale 都能 SSR 渲染示例页（本地 `pnpm dev` 起服务）
6. 起 PR：**只含脚手架 + 1 个示例页**，不带任何真实内容

**Acceptance**：
- `pnpm build` 退出 0
- `pnpm preview`（wrangler dev）下 `/en/docs/example` `/zh/docs/example` `/de/docs/example` 都返回 200
- MDX 中的 markdown、code fence、表格、链接、headings 都渲染
- Shiki dark/light 主题随 next-themes 切换
- top nav 与主站一致

### Session 2 — Layout + Sidebar + Code highlighting

1. 写 `src/lib/docs/sidebar.ts` 配置（先空骨架）
2. `app/[locale]/docs/layout.tsx` 实现左 sidebar 渲染
3. 右 TOC 自动从 MDX heading 提取
4. Shiki theme 与主站 `next-themes` 联动（双 highlight + 客户端切换）
5. 自定义 MDX 组件 `<Callout>`, `<CodeGroup>`（与 aster-lang-dev VitePress::tip / ::warning 等价）
6. Page 标题、面包屑、edit-on-github 链接
7. 起 PR：**chrome 完成**，还没真实 docs 内容

**Acceptance**：
- 任意 3 个示例 MDX 页（en/zh/de 各 1）渲染含 sidebar/TOC/breadcrumb
- Lighthouse a11y ≥ 90、CLS = 0
- 与 aster-lang-dev 视觉差异在可接受范围（colors + typography 一致）

### Session 3 — Migrate 16 getting-started 文件 × 3 locale = 48 个 MDX

1. 从 aster-lang-dev 复制 markdown 内容（`docs/getting-started/*.md`）
2. 转换 frontmatter（VitePress 的 `---title` 等 → MDX `export const meta`）
3. 转换内部链接 `(/api/...)` → `/[locale]/docs/api/...`
4. 转换 code fence（Aster CNL syntax 高亮 —— 用 aster-lang-dev 的 Shiki grammar）
5. `messages/{en,zh,de}.json` 加 `docs.sidebar.gettingStarted.*` keys
6. sidebar config 补完 getting-started 章节
7. 添加 locale-parity CI 检查脚本（locale 间页面数 + frontmatter 字段对齐）
8. 起 PR

**Acceptance**：
- 16 × 3 = 48 个 MDX 文件，pnpm build 通过
- 所有 URL `https://aster-lang.cloud/{en,zh,de}/docs/getting-started/{overview,authentication,quickstart,errors}` 返回 200
- 链接无 dead end（CI 扫描通过）

### Session 4 — Migrate 21 API 文件 × 3 locale = 63 个 MDX

1. 同上流程
2. ⚠️ API docs 内容 zh/de 当前在 aster-lang-dev 是 EN-only 的（按 glossary policy） —— 决策：用 EN 内容填三语 MDX 文件，但 sidebar 标题用本地化；或翻译；这个在 Session 3 做完后单独决策

**Acceptance**：
- 全部 21 × 3 = 63 MDX 文件 build 通过
- 21 个 API endpoint 文档全部 200
- code 示例 syntax highlight 正确

### Session 5（即原 Phase 2）— aster-lang-dev 剥离

详见 aster-lang-dev `.claude/plan/api-docs-strip.md`（Phase 2 计划文档，待写）：

1. git rm 37 个 markdown 文件
2. nav 缩到 5 项
3. i18n 字符串改写
4. `_redirects` 308 跨站
5. HeroAnimation 回到 landing 作 cloud teaser
6. 测试更新
7. ship

---

## 5. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| Next 16 + OpenNext + MDX 三角组合在 Worker runtime 出 incompatibility | 中 | 高（整个 Phase 1 阻塞） | Session 1 优先做最小 spike，build 通过再继续；如失败，降级到 A2（VitePress 子域名） |
| Shiki bundle 过大压垮 Worker bundle size limit | 低 | 中 | 用 `rehype-pretty-code` 的 build-time 编译，langs 只 import 需要的（aster, ts, json, bash） |
| MDX 文件 lock-in：未来想换静态生成器很难 | 低 | 低 | 文件即标准 markdown + frontmatter，可被 VitePress / Astro / Docusaurus 复用 |
| locale 内容漂移（en 改了 zh/de 没改） | 高 | 中 | locale-parity CI 检查；frontmatter `lastReviewed.<locale>` SHA 跟踪 |
| aster-lang.dev 用户记的旧 URL 失效 | 中 | 中 | Phase 2 配 308 跨站 redirect，保留 SEO + 浏览器历史 |
| Smart Placement Melbourne 让欧美用户首屏慢 | 低 | 低 | docs 静态资产由 Cloudflare CDN edge serve，Worker 只 serve dynamic（实际上 docs 全 SSG） |

---

## 6. 测试策略

| 层 | 工具 | 范围 |
|---|---|---|
| Build smoke | `pnpm build` 退出 0 | 必跑每个 PR |
| Page render | Vitest + `next/test` | 每 PR 至少抽 1 个 MDX 页 |
| Locale parity | 自定义 node 脚本 | 检查每页 frontmatter 是否齐全 + 文件存在 |
| Link health | 自定义脚本扫 MDX | 内部链接全部解析到存在的页面 |
| Visual regression | 留 Phase 2 | Playwright + percy 可选 |
| E2E（cross-site redirect） | curl + CI | aster-lang.dev → aster-lang.cloud/docs 实测 308 |

---

## 7. 验收（Phase 1 整体）

- ✅ aster-lang.cloud/docs/*（EN）、/zh/docs/*、/de/docs/* 共 75 个 page URL 全部 200
- ✅ pnpm build & pnpm preview 双通过
- ✅ Lighthouse Performance/A11y/BP/SEO ≥ 85
- ✅ 与主站 dark/light 主题同步
- ✅ aster-lang.dev `_redirects` 308 → `aster-lang.cloud/{locale}/docs/...` 全部解析到 200
- ✅ aster-lang-dev nav 不再包含 `API` 项
- ✅ HeroAnimation 已迁回 landing 作 cloud teaser

---

## 8. 今天（Session 1）的具体动作

1. 安装依赖：`@next/mdx`、`@mdx-js/loader`、`@mdx-js/react`、`@types/mdx`、`remark-gfm`、`remark-frontmatter`、`remark-mdx-frontmatter`、`rehype-pretty-code`、`shiki`、`rehype-slug`、`rehype-autolink-headings`
2. 改 `next.config.ts`：用 `withMDX()` 包，配 `pageExtensions` 含 `mdx`
3. 建 `src/app/[locale]/docs/example/page.mdx`：含 H1/H2/code fence (bash + json + ts + aster)/table/link/callout
4. 建 `src/app/[locale]/docs/layout.tsx`：最小 chrome（top nav 复用、左 placeholder sidebar、content area）
5. 建 `src/app/[locale]/docs/page.tsx`：重定向到 `/docs/example`（demo 期间）
6. 跑 `pnpm build`，确认 `.next` 生成 + OpenNext build 通过
7. 跑 `pnpm dev`，3 个 locale 都验
8. commit + push（但不开 PR，等明天审）

---

## 9. 决策记录

| 日期 | 决策 | 理由 | 谁定的 |
|---|---|---|---|
| 2026-06-02 | 走 A1（Next.js MDX 集成进 aster-cloud） | 同 deploy / 同 i18n / 长期 docs-to-console 跳转一键达 | Ryan |
| 2026-06-02 | (c) 多 session 推进 | 2-3 天工程压一天有出 bug 风险 | Ryan |
| 2026-06-02 | 静态路由 `page.mdx`（不用 catch-all + collection） | 与 Next 16 + OpenNext + Workers 最低阻抗 | Ryan |
| 2026-06-02 | Phase 2（aster-lang-dev 剥离）等 Phase 1 完整 ship 后再做 | 避免短期 404 | Ryan |
