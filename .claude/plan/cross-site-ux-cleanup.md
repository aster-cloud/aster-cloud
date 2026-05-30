# 实施计划:跨站内容真实性 + IA 桥接 + UX/a11y 收尾

> 副标题: 以内容真实性 + IA 桥接为主,视觉调整仅占 PR-7a
> 来源: `/ccg:analyze` 双 codex 审计 (SESSION 019e7a73-594d-7652 / 019e7a73-594d-75b3)
> 二次校验: 两位 architect 复核 PR 切分,采纳所有修正
> 三次校验: `/ccg:audit` 找到 1 P0 + 4 P1 真实性问题,已全部合并(见 §7 audit fixes log)
> 范围: **aster-cloud (Next.js)** + **aster-lang-dev (VitePress)**;不涉及 aster-api
> 仅规划,不修改产品代码

---

## 0. 增强后的需求

把上一轮 `/ccg:analyze` 输出的 P0/P1/P2/P3 行动项,切成 **≤ 8 个可独立合并的 PR**:
- 每个 PR < 30 分钟 review
- 每个改动给到 `file:line` + before/after 文案
- 不引入新功能,只清账面债务
- 双语:任何用户可见文案改动覆盖 en/zh/de

### 核心校正(基于 architect 复核)

**1. Hash-chain audit 文案不应弱化** — aster-api 仓库里 `AuditLog` 实际有完整 hash chain (`prevHash`/`currentHash` + `AuditEventListener.computeHashChain` + `AuditChainVerifier` + 集成测试)。我上一轮的判断只看了 aster-cloud 这一边的 schema 就下结论,是错的。
真实情况: **policy execution audit (aster-api) 是 hash-chained,canonical;cloud dashboard 的 `AuditLog` 是 UI activity 事件流,不在链上**。
PR-1 应该是 **澄清 source-of-truth**,不是 weaken claim。

**2. cloud `AuditLog` 是否需要加 hash chain?** — 不需要(理由见 plan §6 决策记录)。文案修复即可。

**3. PR 顺序** — 真实性 / 死链优先,然后清理,再 UX/copy,最后 polish:
PR-1 (audit 文案澄清) → PR-2 (死链) → PR-4 (邮件) → PR-3 (starter 死代码) → PR-6 (a11y) → PR-5 (IA 桥) → PR-7 (playground) → PR-8 (CTA guide)

---

## 1. 任务类型

- [x] **全栈 + 文档**
- 工作量: ~2-3 天 (一人)
- 后端 / 内容真实性 → codex (后端 SESSION 复用)
- 前端 / a11y / 视觉 → codex (前端 SESSION 复用)
- 由 Claude 落地代码

---

## 2. 综合技术方案

### 2.1 PR 切分总览

| # | 优先级 | 仓库 | 标题 | 文件数 | 风险 |
|---|---|---|---|---|---|
| PR-1 | P0 | aster-lang-dev | Hash-chain audit 文案澄清 (指向 aster-api 才是 canonical) | 4 | 低 |
| PR-2 | P0 | aster-cloud | 修死链 docs.aster-lang.cloud → aster-lang.dev | 1 | 极低 |
| PR-3 | P1 | aster-cloud | 删 `STARTER_PLAN` 死代码 + 简化 DowngradeBanner | 1 | 低 |
| PR-4 | P1 | aster-cloud | 统一销售邮箱 `enterprise@aster-lang.dev` → `sales@aster-lang.cloud` | 1 | 极低 |
| PR-5 | P1 | both | 品牌关系 + 持久 "Open Cloud" CTA + CTA 用语统一 | 6-8 | 中(双语 + 移动布局) |
| PR-6 | P1 | aster-cloud | 公共页 `<main>` + `SkipToContent` 抽组件 | 4 | 低 |
| PR-7a | P1 | aster-lang-dev | Playground 焦点环 + Run 按钮 token | 1 | 中(dark mode 对比) |
| PR-7b | P1 | aster-lang-dev | Pricing 暴露 Domain Vocabularies 限额 + Logo wordmark | 3 | 低 |
| PR-8 | P2 | aster-cloud | CTA voice & naming guide + p99 数字对齐 + lexicon footnote | 3 | 极低 |

---

### 2.2 PR-1 — Hash-chain audit 文案澄清 (P0)

**目标**: dev 文档明确 audit chain = aster-api 的 `AuditLog` (REST + tamper-detection 测试覆盖);cloud dashboard 的 activity 日志不在链上。**不弱化**功能声明,只澄清边界。

**文件改动**:

| 文件 | 行 | Before (截) | After |
|---|---|---|---|
| `aster-lang-dev/docs/index.md` | 33 | "Every evaluation produces a SHA-256 hash-chained audit record." | "Every policy evaluation is recorded in the engine's tamper-evident `AuditLog`, hash-chained with SHA-256. Verify any chain via `GET /api/v1/audit/verify-chain?start=…&end=…`." |
| `aster-lang-dev/docs/learn/deployment-guide.md` | 211-215 | 现有 "Audit records are linked by SHA-256 hash chaining" | 保留;加一行 "The hash chain is enforced by `AuditEventListener` at the policy engine layer; SaaS dashboard activity events are stored separately and link back to chained audit ids." |
| `aster-lang-dev/docs/learn/deployment-guide.md` | **216-220 (curl 块)** | `curl -s -X POST .../api/v1/audit/verify-chain ... -d '{"policyModule":"Loan.Approval"}'` | **改为 GET + query params**: `curl -s "https://policy.aster-lang.dev/api/v1/audit/verify-chain?start=$START&end=$END" -H "Authorization: Bearer $ASTER_TOKEN" -H "X-Tenant-Id: $ASTER_TENANT_ID"`(删 `-X POST`、删 `-d`、加 `?start=&end=` ISO8601 query;header 名修为 `X-Tenant-Id` — aster-api 用的就是这一个 capitalization) |
| `aster-lang-dev/docs/learn/browser-api.md` | 424 | "Automatic SHA-256 chain" (table cell) | 保留,加链接 → `/api/audit/verify-chain` |
| `aster-lang-dev/docs/api/audit/logs.md` | (整篇) | (read first) | 顶部加 admonition: "These endpoints are served by aster-api (the policy engine), not by the aster-cloud SaaS dashboard. Dashboard UI events live in a separate, non-chained activity log." |

**🔴 audit fix #1 (P0 新增)**: 上一版计划只写了 4 个文案改动,**漏掉了 verify-chain 的 HTTP method 契约错误**(dev 文档示例是 `POST + JSON body`,aster-api 实际是 `@GET @QueryParam` — `AuditLogResource.java:142-160`)。用户照 dev 文档 copy-paste 会拿到 405 Method Not Allowed。修复 = 改 curl 命令(见上表第 3 行)。

**为什么这么改**:
- aster-api 真的有 `AuditChainVerifier` + `TamperDetectionIntegrationTest`(架构师查证) — 不能弱化
- cloud `AuditLog` 是 dashboard activity (创建策略/邀请成员等),不是策略执行账本
- 文案需要做的是**消除歧义**,不是降低承诺
- HTTP method 错误是镜像版的 "auditLog hash chain" 那种事 — 跨仓 contract 假设没经实测

**PR description 应附 mitigation 句**:
> "Tamper-evident audit records are hash-chained by the policy engine (aster-api). The SaaS dashboard's activity log cross-references those records but is itself an unchained UI event stream."

**验收**:
1. 文档 build 通过 (`pnpm docs:build`)
2. grep 整个 dev 仓不再有"all audit / every audit log is hash-chained"等过度概括语句
3. **新增** — `curl` 命令真跑一次(可以打到 staging 或返回 401 也 OK,关键看不是 405) — 期望 `200` 或 `401`,**不能 405**

---

### 2.3 PR-2 — 死链 telemetry docs URL (P0)

**文件改动**:

| 文件 | 行 | Before | After |
|---|---|---|---|
| `aster-cloud/src/app/api/v1/telemetry/schema/route.ts` | 54 | `documentationUrl: 'https://docs.aster-lang.cloud/on-prem/telemetry-fields'` | `documentationUrl: 'https://aster-lang.dev/enterprise/telemetry-fields'` |

**架构师已验**: `curl -I https://aster-lang.dev/enterprise/telemetry-fields` 返回 200。

**验收**: tsc + eslint + 任何引用此 endpoint 的测试通过。grep `docs.aster-lang.cloud` 全 cloud 仓再无引用。

---

### 2.4 PR-3 — 删 `STARTER_PLAN` 死代码 (P1)

**目标**: `quota.plan` 实际只能是 `free|trial|pro|team|enterprise`(见 `src/lib/plans.ts`),`STARTER_PLAN === 'starter'` 永不命中。`DowngradeBanner` 的 `starterPlan` prop 是死的。

**架构师决策**: **Option A** — 完全删 `starterPlan` prop + 简化 `DowngradeBanner` 到只接 `trialExpired/trialEndsAt`。

**文件改动**:

| 文件 | 行 | 改动 |
|---|---|---|
| `aster-cloud/src/app/[locale]/(dashboard)/domain-vocabularies/vocabularies-content.tsx` | 28 | 删 `const STARTER_PLAN = 'starter';` |
| 同上 | 314 | 删 `const isStarterPlan = quota.plan === STARTER_PLAN;` |
| 同上 | 434 | `<DowngradeBanner ... />` 移除 `starterPlan={isStarterPlan}` prop |
| `aster-cloud/src/app/[locale]/(dashboard)/domain-vocabularies/pro-gate.tsx` | 89-109 | 删 `starterPlan` 接口字段 + `if (!starterPlan && !trialExpired) return null` 简化为 `if (!trialExpired) return null`。删 starter 相关 jsx 分支(如有)。注释更新。 |

**验收**: tsc + eslint clean;`grep -rn "starterPlan\|STARTER_PLAN" src/` 应为空;UI 行为不变(starter banner 本就不显示)。

**风险**: 若产品未来真加 starter 档,需重新引入。**缓解**:加注释 `// If a 'starter' tier returns, re-add the prop + read plan from quota`。

---

### 2.5 PR-4 — 销售邮箱统一 (P1)

**架构师 grep 复核**: `aster-cloud.cloud` typo **不存在**(我的初次假设是错的);唯一真实问题是 `enterprise@aster-lang.dev`。

**文件改动**:

| 文件 | 行 | Before | After |
|---|---|---|---|
| `aster-cloud/src/app/[locale]/pricing/pricing-content.tsx` | 64 | `mailto:enterprise@aster-lang.dev?subject=...` | `mailto:sales@aster-lang.cloud?subject=Enterprise%20inquiry` |

**邮件路由约定**(写进 PR description,供 PR-8 引用):
- `hello@aster-lang.dev` — community/open-source 询问 (留给 dev 端)
- `sales@aster-lang.cloud` — 所有商业销售(包括 Enterprise)
- `support@aster-lang.cloud` — 客户支持
- `dpo@aster-lang.cloud` — 隐私官

**验收**: grep `enterprise@aster-lang.dev` cloud 全仓为空;tsc + lint。

---

### 2.6 PR-5 — 品牌关系桥 + 持久 CTA + 用语统一 (P1)

**前端架构师 5 个具体放置决策(全部采纳)**:

1. **"Built on Aster Lang" 放 cloud hero subtitle 之下**,不做新 trust card
2. **dev "Open Cloud" 放 nav 最右,Community 之后**,不放在 Pricing 之前
3. **CTA 用语**:`Start free` / `Talk to sales` / `Try Playground` / `Read docs`(首字母大写仅第一词)
4. **Pricing 桥**: dev pricing 加一行 "For self-serve teams, Cloud starts with Free/Pro plans; Enterprise is quoted."
5. **Dev logo**: 用 wordmark-only `docs/public/wordmark-aster-lang.svg`,不在 nav 放 tagline

**文件改动**:

| 文件 | 改动 |
|---|---|
| `aster-cloud/src/app/[locale]/page.tsx` **L229 之后** (subtitle `</p>` 之后,`<Stack>` 之前) | 插入 `<p>` 链接 "Built on the open-source Aster Lang engine. Read the language docs →" → `https://aster-lang.dev` |
| `aster-cloud/src/app/[locale]/page.tsx` 主 CTA(`MarketingPrimaryCta` 调用处,L231-236) | "Start Free Trial" → "Start free" (保持 SaaS-only 条件分支);"Contact Sales" → "Talk to sales"(改 i18n key 而不是字面量) |
| `aster-cloud/src/app/[locale]/pricing/pricing-content.tsx` | Pro 档 CTA → "Start free";Enterprise 档 CTA → "Talk to sales" |
| `aster-cloud/messages/en.json` + `zh.json` + `de.json` | 加/改 `common.startFree`, `common.talkToSales`, `landing.builtOnAsterLang` 等 keys。**严格双语对齐**(由 `messages-consistency.test.ts` 自动校验)。 |
| `aster-lang-dev/docs/.vitepress/locales/en.ts` | nav 数组末尾加 `{ text: 'Open Cloud', link: 'https://aster-lang.cloud', target: '_blank' }`。**zh.ts 和 de.ts 是独立翻译文件,必须同步**(不是 fallback) |
| `aster-lang-dev/docs/index.md` hero (L13/54/79) | "Open the SaaS" → "Start free on Cloud";"Talk to us" → "Talk to sales";"Try in Playground" 保留 |
| `aster-lang-dev/docs/{,zh/,de/}pricing/index.md` — **三套独立翻译,必须同步** | 顶部 callout 加 bridge 句 "For self-serve teams, Cloud starts with Free/Pro plans; Enterprise is quoted." + 链接到 `aster-lang.cloud/pricing`。zh/de 已是完整翻译(`版本对比` / `Editionen vergleichen`),不能跳 |

**风险**:
- "Start free" 在 de 较长 ("Kostenlos starten"),mobile nav 可能 wrap → **缓解**: 在改完后跑 360px 视口快照检查
- 添 nav 项可能挤压其他 nav → **缓解**: 优先省略 "Community" 折叠(若空间紧)

**验收**:
- en/zh/de 文案 keys 完整 (`messages-consistency.test.ts` 通过)
- 360 / 768 / 1280 viewport mobile-first 检查
- cloud `pnpm typecheck && pnpm lint`,dev `pnpm docs:build`
- 全站搜 "Start Free Trial" / "Open the SaaS" / "Contact Sales" 应为空

---

### 2.7 PR-6 — 公共页 a11y landmark + SkipToContent 组件 (P1)

**前端架构师决定**: 抽 `SkipToContent` 组件(landing + pricing 都用,未来公共页也用)。

**文件改动**:

| 文件 | 改动 |
|---|---|
| `aster-cloud/src/components/skip-to-content.tsx` (NEW) | 抽出 dashboard layout L112-117 模式;props: **`targetId` (required, no default)** + `label?`。强制必传以避免下面那个 id collision。 |
| `aster-cloud/src/app/[locale]/(dashboard)/layout.tsx` | 改用 `<SkipToContent targetId="dashboard-main" />`(**显式传 id,不要改 dashboard 的 `<main id="dashboard-main">`** — fragment URL 不破坏) |
| `aster-cloud/src/app/[locale]/page.tsx` L75 | 根 `<div>` → `<main id="main">`;顶部插 `<SkipToContent targetId="main" />` |
| `aster-cloud/src/app/[locale]/pricing/pricing-content.tsx` L107 | `<main>` 加 `id="main"`;顶部插 `<SkipToContent targetId="main" />` |
| `aster-cloud/messages/{en,zh,de}.json` | `common.skipToContent` **已存在**(L23 三套都有),无需新增,只需复用 |

**🟠 audit fix #2 (P1)**: 上一版本计划写 `props: targetId='main'`(默认值),但 dashboard 已经用 `id="dashboard-main"`(`layout.tsx:233`)。若 SkipToContent 默认 `#main` 会让 dashboard 跳到不存在的 fragment。**修正方案**:`targetId` 设为 **required prop**,所有三个调用点显式传值;不要静默重命名 dashboard id。

**验收**:
- Tab 第一下落到 skip link,Enter 跳到正确 fragment(`#main` for landing/pricing,`#dashboard-main` for dashboard)
- 视觉:link 默认 `sr-only`,focus 时显示
- 三个 locale `common.skipToContent` 一致(测试已存在,自动校验)
- axe-core 静态扫描通过 `region` rule

---

### 2.8 PR-7a — Playground 焦点环 + Run 按钮 token (P1)

**架构师强调**: 不要写 `box-shadow: 0 0 0 3px var(--aster-shadow-ring)`;`--aster-shadow-ring` 已含完整 shadow 值,直接 `box-shadow: var(--aster-shadow-ring)`。verify dark mode 对比。

**文件改动**:

| 文件 | 行 | 改动 |
|---|---|---|
| `aster-lang-dev/docs/.vitepress/theme/custom.css` | **444** (`.inputs-textarea:focus`) | 当前 `outline: none + border-color: var(--vp-c-brand-1)`;改为加 `box-shadow: var(--aster-shadow-ring)`(token 已是完整 `0 0 0 3px rgb(...)`,**不要再包一层 `0 0 0 3px`**) |
| 同上 | **L393 `.run-btn` background** | `#22c55e` → `var(--aster-success)`(token = emerald-700 `#047857`)。颜色比原来更深 — 建议 PR 内截图对比 |
| 同上 | **L396 `.run-btn` border** | `1px solid #16a34a` → `1px solid var(--aster-success)`(border 与 bg 同色;或留作 transparent) |
| 同上 | **L404-405 `.run-btn:hover:not(:disabled)`** | `background: #16a34a` → `background: var(--aster-success); filter: brightness(.92)`(token 无 `-strong` 变种,用 filter 实现 hover) |
| 同上 | **L351 `.console-error/-success` 等状态色** | `#fef2f2` / `#450a0a` → `var(--aster-danger-subtle)` / 对应 token |

**🟠 audit fix #3 (P1)**: 上一版只列了 `#16a34a`,**实际 run-btn 用了 3 处 hex**(L393 `#22c55e` bg、L396 `#16a34a` border、L405 hover `#16a34a`);执行者只 grep `#16a34a` 会漏 `#22c55e`。已展开成 4 行明细 + 给出 token 映射。

**Token 名验证**(避免 `--aster-success-strong` 那种不存在的 token):
- ✅ `--aster-success` 存在(`tokens.css:112`, emerald-700)
- ✅ `--aster-success-fg` 存在(`#ffffff`)
- ✅ `--aster-success-subtle` 存在(emerald-50)
- ❌ `--aster-success-strong` **不存在** — 不能用
- ✅ `--aster-shadow-ring` 已是完整 `0 0 0 3px rgb(...)`(无需再 wrap)
- ✅ `--aster-danger-subtle` / `--aster-info-subtle` 类似存在(grep 验证 before merging)

**验收**:
- Tab 在 playground textarea / Run / Reset / tabs 上焦点环可见 (light + dark)
- contrast checker: 焦点环对底 ≥ 3:1
- VitePress dev server 跑得起,playground 工作正常
- run-btn 在 light/dark 视觉上仍像"成功/Run" — emerald-700 比原 #22c55e 深,需人眼确认

---

### 2.9 PR-7b — Pricing 暴露 Domain Vocabularies + Logo wordmark (P1)

**文件改动**:

| 文件 | 改动 |
|---|---|
| `aster-lang-dev/docs/{,zh/,de/}pricing/index.md` (Cloud 列) — **三套独立翻译,必须同步** | 加一行: "Custom domain vocabularies — Free: none · Pro: 5,000 terms · Enterprise: unlimited" + 链接 `aster-lang.cloud/domain-vocabularies`。**注**: 不提 `trial` (500) 和 legacy `team` (25,000) —— 它们不在公开自助流程里(trial 是注册临时态;team 已下线,DB enum 保留)。这与 `plans.ts` 注释 "PM v1.1 三档" 一致。 |
| `aster-lang-dev/docs/zh/pricing/index.md` | 同步翻译 (若存在;若沿用 EN 文件则跳过) |
| `aster-lang-dev/docs/de/pricing/index.md` | 同步翻译 (同上) |
| `aster-lang-dev/docs/public/wordmark-aster-lang.svg` (NEW) | 新 wordmark SVG 资源 |
| `aster-lang-dev/docs/.vitepress/config.ts` L15 | `themeConfig.logo` 改用 wordmark(only,no tagline);verify nav 高度仍 legible |

**验收**: VitePress build OK;wordmark 在 1280 / 768 / 360 视口都清晰;dark mode 不丢笔画

---

### 2.10 PR-8 — CTA 用语 + 命名 + 数字对齐 (P2)

**前端架构师**: 文档放 `aster-cloud/docs/brand/cta-and-naming.md`(cloud 主导商业转化),dev 引用即可。

**文件改动**:

| 文件 | 改动 |
|---|---|
| `aster-cloud/docs/brand/cta-and-naming.md` (NEW) | 写明 4 个 CTA 用语 + Aster Lang vs Aster Cloud 命名 + 邮件路由 |
| `aster-cloud/docs/operations/slo.md` (现有) | **不需要改** — 实际 SLO 已有三档,dev 端 200ms 对应的是 "Policy execution p99 < 200ms"(同义)。审计校验:cloud SLO 三行(`/evaluate < 100ms`, `/evaluate-source < 1000ms`, `Policy execution < 200ms`)与 dev 端 `P99 latency under 200ms` 指向 "policy execution" 维度,**已一致**。若要更清晰可加注脚 "(applies to /evaluate; /evaluate-source 包括解析,目标 < 1000ms)" |
| `aster-lang-dev/docs/index.md` & cloud landing | "Three lexicons" 加注脚 "(EN canonical; ZH/DE community-maintained)" |
| `aster-lang-dev/docs/community/contribute.md` L69 | 当前 `[discord.aster-lang.cloud](https://aster-lang.cloud/community) — real-time chat (planned)`。**不是死链**(href 解析到 `aster-lang.cloud/community`),但 link text 看起来像活 Discord 域名。改为 `[Discord (planned)](https://aster-lang.cloud/community) — real-time chat`,避免用户复制 link text 当真实 URL |
| `aster-cloud/messages/en.json` L782 FAQ | 当前 `"Pro and Team users get priority support..."` — `team` 已下线(plans.ts 注释 "team 已下线,DB enum 保留")。改为 `"Pro users get priority support with faster response times."` |

**🟠 audit fix #4 (P2)**: 上一版 PR-8 误把 SLO 数字写成需要"对齐";实际三档 SLO 已经覆盖 dev 端 200ms 那条。**改动方案降级为可选** — 若仍想加注脚说明 evaluate vs evaluate-source 区分,加;否则跳过。

**🟢 audit fix #5 (P3)**: 上一版把 `discord.aster-lang.cloud` 描述为 "死链";实际是 link text 误导(href 解析到 community 页面)。改为修 link text 而非删行。

**验收**:
- 文档 build OK
- grep `Team users\|Team support` cloud 全仓不再出现(legacy 文案清理)
- discord link text 不再是裸 `.cloud` 域名

---

## 3. 实施顺序

按风险递增顺序 + 解锁顺序:

```
Day 1 (P0): PR-1 → PR-2 → PR-4 → PR-3
Day 2 (P1): PR-6 → PR-7a → PR-7b
Day 3 (P1/P2): PR-5 → PR-8
```

理由:
- PR-1/2 是真实性 bug(死链 + 文档过度泛化),最先
- PR-3/4 是清理,无 UI 风险
- PR-6 (a11y) 影响所有公共页用户,先于内容文案改动
- PR-7a/b 限定到 playground 单个 surface,并行风险低
- PR-5 是最大 surface(双站 + 双语 + nav + CTA),最后再做
- PR-8 是文档收尾,不阻塞任何东西

---

## 4. 关键文件总览

### aster-cloud (`/Users/rpang/IdeaProjects/aster-cloud`)
| 文件 | PR | 操作 |
|---|---|---|
| `src/app/api/v1/telemetry/schema/route.ts:54` | PR-2 | 修 URL |
| `src/app/[locale]/(dashboard)/domain-vocabularies/vocabularies-content.tsx:28,314,434` | PR-3 | 删死代码 |
| `src/app/[locale]/(dashboard)/domain-vocabularies/pro-gate.tsx:89-109` | PR-3 | 简化 DowngradeBanner |
| `src/app/[locale]/pricing/pricing-content.tsx:64` | PR-4 | 邮箱 |
| `src/app/[locale]/pricing/pricing-content.tsx` (Pro/Enterprise CTAs) | PR-5 | CTA 改名 |
| `src/app/[locale]/page.tsx` (hero L181 周边) | PR-5 | 关系语 + CTA 改名 |
| `src/app/[locale]/page.tsx:75` | PR-6 | `<main id="main">` |
| `src/app/[locale]/pricing/pricing-content.tsx:107` | PR-6 | `id="main"` |
| `src/app/[locale]/(dashboard)/layout.tsx:112` | PR-6 | 改用 `SkipToContent` |
| `src/components/skip-to-content.tsx` (NEW) | PR-6 | 抽组件 |
| `messages/{en,zh,de}.json` | PR-5 | i18n keys |
| `messages/en.json:782` | PR-8 | Team FAQ 修 |
| `docs/operations/slo.md` | PR-8 | p99 数字加限定 |
| `docs/brand/cta-and-naming.md` (NEW) | PR-8 | 文档 |

### aster-lang-dev (`/Users/rpang/IdeaProjects/aster-lang-dev`)
| 文件 | PR | 操作 |
|---|---|---|
| `docs/index.md:33,~54` | PR-1, PR-5 | 文案 |
| `docs/learn/deployment-guide.md:212` | PR-1 | 文案 |
| `docs/learn/browser-api.md:424` | PR-1 | 文案 |
| `docs/api/audit/logs.md` | PR-1 | 顶部 admonition |
| `docs/.vitepress/locales/{en,zh,de}.ts` | PR-5 | nav + CTA |
| `docs/pricing/index.md` | PR-5, PR-7b | 桥句 + vocab 行 |
| `docs/zh/pricing/index.md`, `docs/de/pricing/index.md` (若存在) | PR-5, PR-7b | 同步 |
| `docs/.vitepress/theme/custom.css:392-450 附近` | PR-7a | token + 焦点环 |
| `docs/public/wordmark-aster-lang.svg` (NEW) | PR-7b | logo asset |
| `docs/.vitepress/config.ts:15` | PR-7b | themeConfig.logo |
| `docs/community/contribute.md:69` | PR-8 | discord 死链 |

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| PR-1 弱化 audit 声明,Enterprise 客户担忧 | 不弱化,**澄清范围**。PR description 内附说明句:"Tamper-evident audit records are hash-chained by the policy engine (aster-api); the SaaS dashboard's activity log cross-references those records but is itself an unchained UI event stream." |
| **PR-1 verify-chain curl 修后没人验** | 改完真跑一次 `curl -X GET "https://policy.aster-lang.dev/api/v1/audit/verify-chain?start=...&end=..."`,期望 200 / 401;**不能是 405**(那就是又写错了)。staging token 拿不到至少用本地 aster-api 跑 |
| **PR-4 邮件路由:`enterprise@aster-lang.dev` 是否真有人收?** (从 §6.2 提升) | **PR-4 阻塞条件**:改之前必须确认 (a) 旧地址是否还有现存收件人;(b) 若有,先配 forwarding 到 sales@aster-lang.cloud。否则会丢失正在飞行的 Enterprise inquiry |
| PR-3 未来加 starter 档需重新引入 prop | 注释告知;reread `plans.ts` 是单一真相 |
| PR-5 双语文案打错 | `messages-consistency.test.ts` 已存在,会捕获缺 key + ICU 占位符 drift;改动后必跑 |
| PR-5 mobile nav wrap("Open Cloud" + "Start free" 双新短语) | 改完后在 360 / 768 viewport 手测 + 跑 chrome-devtools MCP screenshot |
| **PR-6 SkipToContent 默认 id 与 dashboard 冲突** | `targetId` 设为 required prop,**三个调用点全部显式传值**(`#main` for landing/pricing, `#dashboard-main` for dashboard);不要静默重命名 dashboard id 破坏 fragment URL |
| PR-7a dark mode 焦点环 / Run 按钮新 emerald 比原 #22c55e 深,视觉变化 | axe-core 在 light/dark 各验对比;PR 附前后截图 |
| **PR-7a `--aster-success-strong` token 不存在** | 不能用;hover 用 `filter: brightness(.92)` 或退回 raw `--aster-color-emerald-600` |
| PR-7b wordmark SVG 在 nav 太大/不清 | 验证后再合 |
| **PR-7b 五档 (free/trial/pro/team/enterprise) 描述漏 trial/team** | 公开文案只列 free/pro/enterprise(对齐 PM v1.1 三档化);其余在 `plans.ts` 注释里保留,不公开 |
| 跨仓 PR(PR-5, PR-8)同一 sprint 两个仓变 | 分开 PR,确保 cloud 端 PR 先合(不依赖 dev) |
| `<main>` 改动可能破坏 css 选择器(若有 `div > .container` 等) | grep 公共页 CSS 是否依赖 `<div>` 标签;通常 Tailwind class-based,不依赖 |
| **dev pricing zh/de 是独立翻译,不是 fallback** | 所有 PR-5/PR-7b 内容改动必须改 3 套 markdown 文件(en + zh + de);不能省略其中任何一个 |

---

## 6. 决策记录(非代码改动,但记入计划)

### 6.1 cloud `AuditLog` 是否要加 hash chain?

**结论: 不加**

**理由**:
1. **真实合规链已经在 aster-api** — `AuditEventListener.computeHashChain` + `AuditChainVerifier` + 集成测试(架构师查证)
2. cloud `AuditLog` 是 **dashboard UI activity 事件**(创建策略 / 邀请成员 / 购买 Pro),不是策略执行账本
3. 合规审计真正要的是 **policy execution audit**,cloud activity log 改了不影响业务规则结果,价值低
4. 加 hash chain 有代价:写锁、读校验、脏数据修复麻烦
5. 与其加链兜底文案,不如**改文案准确反映现状**(PR-1 就是干这事)

**未来何时重审**:
- 若有合规标准明确要求 dashboard UI 行为本身需 tamper-evident(如 SOX 对管理动作要求 immutable audit) → 重审
- 若 cloud activity log 被 Enterprise 客户当 "操作审计" 在用 → 重审
- 现在不阻塞

### 6.2 `enterprise@aster-lang.dev` 真有人收吗?

> **已升级到 §5 风险表**,作为 PR-4 阻塞条件。本节保留作为决策上下文 — 决议: PR-4 不能在邮件路由确认前合并。

### 6.3 Domain Vocabularies 暴露在 dev pricing 是否合适?

**合适**。理由:
- 它是付费功能,不是开源功能(getLexiconQuota 在 aster-cloud,不在 aster-lang-core)
- 但**用户决定要不要 Pro 时需要这个信息**
- dev pricing 已经列了 "Custom language-pack engineering" 等 Cloud-only 项,Vocabularies 应该同等待遇
- 标注"Cloud 独占"避免给 OSS 用户错觉

---

## 7. Audit fixes log (`/ccg:audit` 三次校验)

第三轮 audit 给计划本身评 **14/20 (Good)**,找到 1 P0 + 4 P1 + 3 P2 + 3 P3 真实性问题,**全部合并到本计划**:

| Fix # | Severity | 原始问题 | 修复位置 |
|---|---|---|---|
| #1 | **P0** | PR-1 漏掉 dev `deployment-guide.md:216` 的 verify-chain `POST + JSON body` 与 aster-api 实际 `@GET + ?start=&end=` 不符(镜像版的 "auditLog hash chain" 错) | §2.2 PR-1 文件表新增第 3 行 + 新增"audit fix #1" 标注 + §5 风险表新增 curl 验证步骤 |
| #2 | P1 | PR-6 SkipToContent 默认 `targetId='main'` 会让 dashboard 现有 `id="dashboard-main"` 失效 | §2.7 改为 required prop + 三个调用点显式传值 + §5 风险表新增条目 |
| #3 | P1 | PR-7a Run-button hex 引用不全(漏 `#22c55e` bg) | §2.8 展开成 4 行明细 + 列出全部 token 名 + 标注 `--aster-success-strong` 不存在 |
| #4 | P1 | PR-7b "5,000 / unlimited" 漏 trial(500) 和 team(25000) | §2.9 改为 "Free: none · Pro: 5,000 · Enterprise: unlimited" + 注明 PM v1.1 三档化 |
| #5 | P1 | PR-5/PR-7b 用 "若存在" 模糊措辞;实际 zh/de pricing 是独立翻译 | §2.6 + §2.9 改为 "三套独立翻译,必须同步" + §5 风险表新增条目 |
| #6 | P2 | PR-5 hero 位置 "约 L181" 太松 — 真实插入点是 L229 后 | §2.6 表格精确到 "L229 之后 (subtitle `</p>` 后,Stack 前)" |
| #7 | P2 | PR-8 把 contribute.md `discord.aster-lang.cloud` 当死链 — 实际只是 link text 误导 | §2.10 改为修 link text 而非删行 |
| #8 | P2 | PR-8 p99 数字对照过简 — 实际 cloud SLO 三档与 dev 200ms 已一致 | §2.10 改动方案降级为可选注脚 |
| #9 | P3 | 计划标题"网站易用性和布局视觉优化"误导(实际 80% 真实性/IA) | §0 加副标题 "以内容真实性 + IA 桥接为主" |
| #10 | P3 | §6.2 邮件路由确认本是 PR-4 阻塞条件,放决策记录里弱化了 | 升级到 §5 风险表;§6.2 保留作上下文 |
| #11 | P3 | PR-1 mitigation 句模式可推广,不该只在 PR-1 内 | 已通过 §5 风险表统一(每个 PR 在风险表中有独立条目) |

**Audit 自身验证的事实**(防止三轮再翻车):
- ✅ aster-api `AuditLog.java` 真有 `prevHash` + `currentHash`(`schema.ts:140,147`) + `AuditEventListener.computeHashChain`(`L145`) + `AuditChainVerifier`(独立 class)
- ✅ `common.skipToContent` 三语 i18n key 都在(`messages/{en,zh,de}.json:23`)
- ✅ `--aster-shadow-ring` 是完整 shadow 值,不要 wrap
- ✅ `--aster-success` 存在,`--aster-success-strong` 不存在
- ✅ `aster-lang.dev/enterprise/telemetry-fields` 返回 200;`docs.aster-lang.cloud/...` 死
- ✅ `enterprise@aster-lang.dev` 在 `pricing-content.tsx:64` 真实存在
- ✅ `STARTER_PLAN` 是死代码(plans.ts 只有 `free/trial/pro/team/enterprise`)
- ✅ `messages-consistency.test.ts` 真存在,enforces ICU + key tree
- ❌ aster-api verify-chain 是 `@GET` 不是 POST(PR-1 已修)

---

## 8. SESSION_ID(供 `/ccg:execute` 复用)

- **后端权威**: `019e7a73-594d-7652-8c1a-42bee5d8421b`
- **前端权威**: `019e7a73-594d-75b3-a183-81c1d79e3d61`

> 这两个 session 已经包含完整审计上下文 + 二次 PR-cut 复核结论 + 三次 audit fixes log,直接 resume 即可。
