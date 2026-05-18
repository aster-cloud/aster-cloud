# 实施计划：deploymentMode 特性开关（SaaS / On-Prem）

> 作者：Claude（codex 双模型协作不可用，已降级为单模型规划 — 详见末尾 SESSION_ID 段落）
> 工作区：`/Users/rpang/IdeaProjects/aster-cloud`
> 日期：2026-05-18

---

## 0. 任务类型

- [x] 前端（导航、页面 404、admin 子壳、i18n、空状态）
- [x] 后端（helper 模块、API route 404、tenant 作用域、env 校验、tree-shake）
- [x] **全栈** — 同一开关在编译期决定两套构建

---

## 1. 目标与验收标准

### 目标
一份源代码，两种发行版：

| 模式 | 命令 | 产物特征 |
|---|---|---|
| SaaS（现状） | `pnpm build`（默认 `DEPLOYMENT_MODE=saas`） | 含 Stripe / 风险评分 / 跨租户管理 / 自助注册 |
| On-Prem | `DEPLOYMENT_MODE=on-prem pnpm build` | Stripe SDK / 风险评分 / 计费页 / 跨租户查询全部从 bundle 中**消失**；占位 license / SSO 路由 |

### 验收标准（这是要在合并前验证的清单）

1. **单源代码** — 不能 fork 任何 `*.saas.tsx` / `*.onprem.tsx` 文件；差异通过 helper + 编译期常量折叠表达
2. **构建分离** — `DEPLOYMENT_MODE=on-prem pnpm build` 产物中 `grep -i "stripe\|risk.tier" .open-next/worker.js` 应返回零匹配（除变量名残留，见 §10）
3. **路由一致性** — on-prem 访问 `/pricing`、`/billing`、`/admin/risk-tier`、`/admin/billing` 应返回 404（不是 302、不是空白）
4. **测试覆盖双模式** — `pnpm test` 默认跑 SaaS，`DEPLOYMENT_MODE=on-prem pnpm test` 跑 on-prem 套件
5. **零散落开关** — `grep -rn "process.env.DEPLOYMENT_MODE" src/` 应只命中 helper 模块本身（约 1-3 处）；其它所有判断走 `isSaaS()` / `canShowBilling()` 等命名谓词
6. **i18n 完整** — 两种构建下 `pnpm check:locales` 都通过；不允许 on-prem 缺失某 SaaS 翻译键导致运行期 console warning
7. **env 校验** — `STRIPE_*` 在 on-prem 构建启动时**不报缺失**；`LICENSE_KEY` 在 SaaS 构建启动时**不报缺失**
8. **回滚** — 移除 `DEPLOYMENT_MODE` 环境变量后默认 = SaaS，行为与 main 分支完全一致

---

## 2. 技术方案

### 2.1 三层架构

```
┌─────────────────────────────────────────────────────┐
│ Layer 1: 编译期常量（next.config.ts DefinePlugin） │
│   __DEPLOYMENT_MODE__: 'saas' | 'on-prem'           │
│   → Webpack/Turbopack 折叠 `if (__... === 'saas')`  │
│   → Dead-code elimination 真正移除分支             │
└─────────────────────────────────────────────────────┘
                       ↓ 包装层
┌─────────────────────────────────────────────────────┐
│ Layer 2: 类型化 helper（src/lib/deployment-mode.ts）│
│   getDeploymentMode(): DeploymentMode               │
│   isSaaS() / isOnPrem(): boolean                    │
│   canShow* 谓词族                                   │
│   → 所有调用方只看 helper，不直接读 env             │
└─────────────────────────────────────────────────────┘
                       ↓ 消费层
┌─────────────────────────────────────────────────────┐
│ Layer 3: 调用点                                     │
│   - 服务端：导入 helper                             │
│   - 客户端：useDeploymentMode() hook（注入 build）  │
│   - 路由：page.tsx 用 notFound()                    │
│   - 导航：filter(item => item.canShow(mode))        │
└─────────────────────────────────────────────────────┘
```

**为什么不用纯 runtime env**：on-prem 客户的构建必须**物理上不包含** Stripe SDK 代码（合规 + bundle size + 攻击面）。runtime 判断只能隐藏 UI，不能 tree-shake。

**为什么不用纯编译期宏**：测试套件需要在同一进程里切换两种模式；helper 提供一个测试覆盖点（vi.mock）。

### 2.2 数据流

```
process.env.DEPLOYMENT_MODE
       ↓ (build time, next.config.ts)
DefinePlugin → __DEPLOYMENT_MODE__ (compile-time literal)
       ↓ (typed wrapper)
src/lib/deployment-mode.ts → getDeploymentMode() = 'saas' | 'on-prem'
       ↓ (semantic predicates)
canShowBilling(), canShowRiskTier(), canShowLicense(), isMultiTenantAdmin()
       ↓
- src/app/[locale]/(dashboard)/billing/page.tsx → if (!canShowBilling()) notFound()
- src/app/api/stripe/webhook/route.ts → if (!canShowBilling()) return 404
- src/components/dashboard/sidebar.tsx → NAV_ITEMS.filter(i => i.canShow())
- src/lib/env-validation.ts → ENV_CHECKS[i].requiredIn: ['saas']
```

### 2.3 反向不变量

| 不变量 | 由谁守护 |
|---|---|
| on-prem bundle 无 Stripe SDK | §10 bundle 验证脚本 |
| 两种模式下所有页面有合法响应（200 或 404，无 500） | §8 E2E smoke test |
| 翻译键无遗漏 | `pnpm check:locales` 在两种模式下都跑 |
| helper 是唯一开关访问点 | `pnpm lint:no-direct-env` 自定义 ESLint 规则 |

---

## 3. 实施步骤（按 PR 顺序）

> 全程：每个 PR 都保持 SaaS 构建绿。直到 PR-7 之前 on-prem 不需要可运行，只需 helper + 路由壳到位。

### PR-1：核心 helper + 编译期常量（半天，零风险）

**目标**：建立 `deployment-mode.ts` 单一入口，SaaS 行为零变化。

```ts
// src/lib/deployment-mode.ts
export type DeploymentMode = 'saas' | 'on-prem';

declare const __DEPLOYMENT_MODE__: DeploymentMode; // 由 DefinePlugin 注入

const FALLBACK: DeploymentMode = 'saas';

export function getDeploymentMode(): DeploymentMode {
  // 编译期常量优先；测试 / SSR 边界用 env 兜底
  if (typeof __DEPLOYMENT_MODE__ !== 'undefined') return __DEPLOYMENT_MODE__;
  const raw = process.env.DEPLOYMENT_MODE;
  return raw === 'on-prem' ? 'on-prem' : FALLBACK;
}

export const isSaaS = () => getDeploymentMode() === 'saas';
export const isOnPrem = () => getDeploymentMode() === 'on-prem';

// 语义谓词 — 所有调用方看这些，不直接看 mode 字符串
export const canShowBilling   = () => isSaaS();
export const canShowPricing   = () => isSaaS();
export const canShowRiskTier  = () => isSaaS();
export const canShowDunning   = () => isSaaS();
export const canShowSignup    = () => isSaaS();
export const canShowLicense   = () => isOnPrem();
export const canShowSsoConfig = () => isOnPrem();
export const isMultiTenantAdmin = () => isSaaS();
```

```ts
// next.config.ts (新增片段)
import type { NextConfig } from 'next';
import webpack from 'webpack';

const mode = process.env.DEPLOYMENT_MODE === 'on-prem' ? 'on-prem' : 'saas';

const nextConfig: NextConfig = {
  // ... existing ...
  webpack: (config, ctx) => {
    config.plugins.push(
      new webpack.DefinePlugin({
        __DEPLOYMENT_MODE__: JSON.stringify(mode),
      }),
    );
    // 把现有 webpack callback 链到这里
    return config;
  },
  env: {
    NEXT_PUBLIC_DEPLOYMENT_MODE: mode, // 给客户端组件
  },
};
```

```ts
// src/hooks/use-deployment-mode.ts (客户端 hook)
'use client';
import type { DeploymentMode } from '@/lib/deployment-mode';
export function useDeploymentMode(): DeploymentMode {
  return (process.env.NEXT_PUBLIC_DEPLOYMENT_MODE as DeploymentMode) ?? 'saas';
}
```

**测试**：单元测试 mock helper，验证 SaaS / on-prem 切换返回正确值。

**验收**：`pnpm test`、`pnpm build` 全绿；helper 未被任何业务代码导入（仍是死代码，无副作用）。

---

### PR-2：env-validation 接入 deployment-mode

**目标**：让 `ENV_CHECKS` 按模式声明，SaaS 不再报 LICENSE_KEY 缺失，on-prem 不再报 STRIPE 缺失。

```ts
// src/lib/env-validation.ts (修改)
import { getDeploymentMode } from './deployment-mode';

type EnvCheck = {
  key: string;
  required: 'always' | 'production-only';
  requiredIn?: ReadonlyArray<DeploymentMode>; // 默认 ['saas','on-prem']
  description: string;
};

const ENV_CHECKS: readonly EnvCheck[] = [
  { key: 'DATABASE_URL',    required: 'always', description: '...' },
  { key: 'AUTH_SECRET',     required: 'production-only', description: '...' },

  // SaaS 专属
  { key: 'STRIPE_SECRET_KEY',                       required: 'production-only', requiredIn: ['saas'], description: '...' },
  { key: 'STRIPE_WEBHOOK_SECRET',                   required: 'production-only', requiredIn: ['saas'], description: '...' },
  { key: 'NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID', required: 'production-only', requiredIn: ['saas'], description: '...' },
  // ... 其它 Stripe price IDs 全部加 requiredIn: ['saas']
  { key: 'NEXT_PUBLIC_MIXPANEL_TOKEN',              required: 'production-only', requiredIn: ['saas'], description: '...' },
  { key: 'CRON_SECRET',                             required: 'production-only', description: '...' }, // 两种都要
  { key: 'RESEND_API_KEY',                          required: 'production-only', requiredIn: ['saas'], description: '...' },

  // On-Prem 专属（先占位，PR-7 之后真正校验）
  { key: 'LICENSE_KEY',     required: 'production-only', requiredIn: ['on-prem'], description: 'Aster Enterprise license key' },
  { key: 'SSO_PROVIDER',    required: 'production-only', requiredIn: ['on-prem'], description: 'SAML / OIDC provider id' },
];

export function checkEnv(env = process.env): ValidationResult {
  const mode = getDeploymentMode();
  // ... 既有逻辑，但筛选时跳过 !check.requiredIn?.includes(mode)
  for (const check of ENV_CHECKS) {
    if (check.requiredIn && !check.requiredIn.includes(mode)) continue;
    // ... 现有 missing/warning 逻辑
  }
}
```

**测试**：每个模式的快照，确认缺失列表正确。

---

### PR-3：admin shell 抽出（仅 SaaS 影响 — 是 UX 改进）

**目标**：建立 `/admin/*` 专属布局，为后续按模式过滤 admin 子页做准备。

```tsx
// src/app/[locale]/(dashboard)/admin/layout.tsx (新增)
import { redirect } from 'next/navigation';
import { isAdminFromSession } from '@/lib/admin-auth';
import { getDeploymentMode } from '@/lib/deployment-mode';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { getTranslations } from 'next-intl/server';

export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const ctx = await isAdminFromSession();
  if (!ctx) redirect(`/${locale}/dashboard`); // 非 admin 静默回主页

  const t = await getTranslations('admin');
  const mode = getDeploymentMode();

  return (
    <div className="grid grid-cols-[240px_1fr] min-h-screen">
      <AdminSidebar mode={mode} t={t} />
      <main className="p-6">
        <header className="mb-4 flex items-center gap-2">
          <span className="rounded bg-red-100 text-red-900 px-2 py-0.5 text-xs font-semibold">
            {mode === 'saas' ? 'ADMIN CONSOLE — SaaS' : 'ADMIN CONSOLE — On-Prem'}
          </span>
        </header>
        {children}
      </main>
    </div>
  );
}
```

```tsx
// src/components/admin/admin-sidebar.tsx (新增)
type NavItem = {
  href: string;
  labelKey: string;
  canShow: () => boolean;
};

import {
  canShowRiskTier,
  canShowBilling,
  canShowLicense,
  canShowSsoConfig,
  isSaaS,
} from '@/lib/deployment-mode';

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',                  labelKey: 'nav.overview',      canShow: () => true },
  { href: '/admin/users',            labelKey: 'nav.users',         canShow: () => true },        // PR-5
  { href: '/admin/ai-circuit-breaker', labelKey: 'nav.aiBreaker',   canShow: () => true },        // 两种都有
  { href: '/admin/risk-tier',        labelKey: 'nav.riskTier',      canShow: canShowRiskTier },   // SaaS only
  { href: '/admin/billing',          labelKey: 'nav.billing',       canShow: canShowBilling },    // SaaS only — PR-5
  { href: '/admin/audit-log',        labelKey: 'nav.audit',         canShow: () => true },        // PR-6
  { href: '/admin/license',          labelKey: 'nav.license',       canShow: canShowLicense },    // on-prem only
  { href: '/admin/sso',              labelKey: 'nav.sso',           canShow: canShowSsoConfig },  // on-prem only
];

export function AdminSidebar({ mode, t }) {
  const items = ADMIN_NAV.filter(i => i.canShow());
  return (
    <nav className="border-r p-4 space-y-1">
      {items.map(item => (
        <Link key={item.href} href={item.href}>{t(item.labelKey)}</Link>
      ))}
    </nav>
  );
}
```

**SaaS 影响**：admin 用户现在看到统一壳；现有 `/admin/risk-tier` 和 `/admin/ai-circuit-breaker` 行为不变。

---

### PR-4：包裹现有 SaaS-only 页面 / API

**目标**：每个 SaaS 专属路由用 `canShow*` 谓词守门，on-prem 自动 404。

**模式**（统一）：

```tsx
// src/app/[locale]/(dashboard)/billing/page.tsx
import { notFound } from 'next/navigation';
import { canShowBilling } from '@/lib/deployment-mode';

export default async function BillingPage() {
  if (!canShowBilling()) notFound(); // 编译期常量折叠后 on-prem 这行变成 notFound()
  // ... existing
}
```

```ts
// src/app/api/stripe/webhook/route.ts
import { NextResponse } from 'next/server';
import { canShowBilling } from '@/lib/deployment-mode';

export async function POST(req: Request) {
  if (!canShowBilling()) return new NextResponse(null, { status: 404 });
  // ... existing Stripe webhook logic
}
```

**完整待包裹清单**：

| 路径 | 谓词 | 备注 |
|---|---|---|
| `src/app/[locale]/(dashboard)/billing/page.tsx` | `canShowBilling` | |
| `src/app/[locale]/(dashboard)/billing/billing-content.tsx` | — | 由 page 守门，组件不重复检查 |
| `src/app/[locale]/pricing/page.tsx` | `canShowPricing` | |
| `src/app/[locale]/(auth)/signup/page.tsx` | `canShowSignup` | |
| `src/app/[locale]/(dashboard)/admin/risk-tier/page.tsx` | `canShowRiskTier` | 已有 admin gate，叠加 mode 检查 |
| `src/app/api/stripe/webhook/route.ts` | `canShowBilling` | |
| `src/app/api/stripe/portal/route.ts` | `canShowBilling` | |
| `src/app/api/stripe/checkout/route.ts` | `canShowBilling` | |
| `src/app/api/admin/risk-tier/route.ts` | `canShowRiskTier` | |
| `src/app/api/cron/risk-tier-decay/route.ts` | `canShowRiskTier` | |
| `src/app/api/user/dunning-status/route.ts` | `canShowBilling` | 催收逻辑只 SaaS 有 |

**Tree-shake 触发条件**：每个 page/route 的 `if (!canShowBilling()) notFound()` 必须出现在导入语句**之后**但实际 Stripe SDK 调用**之前**。Stripe SDK 的导入也要懒加载：

```ts
// src/lib/stripe.ts 模式
import { isSaaS } from '@/lib/deployment-mode';

let _stripe: import('stripe').Stripe | null = null;
export async function getStripe() {
  if (!isSaaS()) throw new Error('Stripe unavailable in on-prem build');
  if (!_stripe) {
    const { default: Stripe } = await import('stripe'); // 动态 import — on-prem 编译期常量 false → 这行不会被执行 → bundler 可以删
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
  }
  return _stripe;
}
```

> **关键**：必须配合 PR-1 的 `DefinePlugin` 让 `isSaaS()` 折叠成 `false`；webpack 看到 `if (false) ...` 才会真正删除分支。Drizzle / Next.js webpack 配置可能要禁用某些优化，PR-1 验证时确认。

---

### PR-5：导航 + 客户端组件按模式渲染

**目标**：dashboard sidebar、用户菜单、登录页等客户端 UI 元素按模式隐藏。

```tsx
// src/components/dashboard/sidebar.tsx (修改)
'use client';
import { useDeploymentMode } from '@/hooks/use-deployment-mode';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'home', show: () => true },
  { href: '/policies',  label: 'policies', show: () => true },
  { href: '/billing',   label: 'billing', show: (mode) => mode === 'saas' },
  { href: '/pricing',   label: 'upgrade', show: (mode) => mode === 'saas' },
];

export function Sidebar() {
  const mode = useDeploymentMode();
  return (
    <nav>{NAV_ITEMS.filter(i => i.show(mode)).map(...)}</nav>
  );
}
```

**用户菜单**：
```tsx
{mode === 'saas' && <MenuItem href="/billing">{t('manageSubscription')}</MenuItem>}
{mode === 'on-prem' && <MenuItem href="/admin/license">{t('licenseStatus')}</MenuItem>}
```

**marketing home `/`** — 用变体组件避免 fork：
```tsx
// src/app/[locale]/page.tsx
import { isSaaS } from '@/lib/deployment-mode';
import { SaasMarketingHero, OnPremMarketingHero } from '@/components/marketing/hero';

export default function Home() {
  return isSaaS() ? <SaasMarketingHero /> : <OnPremMarketingHero />;
}
```

> **不要**把整个 `page.tsx` 改成 `if/else` 长函数——抽两个 hero 组件保持可读。

---

### PR-6：tenant 作用域抽象（admin 查询）

**目标**：admin 查询走统一的 `scopeAdminQuery()` helper，SaaS = 全表，on-prem = 当前部署的所有用户（其实也是全表，但语义上"这个部署 = 一个客户"）。

```ts
// src/lib/admin-scope.ts (新增)
import { isSaaS } from '@/lib/deployment-mode';
import { auth } from '@/auth';
import { sql, type SQL } from 'drizzle-orm';

/**
 * 返回 WHERE 子句限定 admin 可见范围。
 *
 * - SaaS：admin 是 Aster 员工，看所有租户 → 返回 SQL `TRUE`（无限制）
 * - On-Prem：admin 是客户 IT，看本部署所有用户 → 当前也是 `TRUE`（单部署
 *   单客户），但保留接口以便未来 on-prem 支持多 org（同部署多客户）时
 *   只改这里。
 */
export async function adminVisibilityFilter(): Promise<SQL> {
  if (isSaaS()) return sql`TRUE`;
  // 未来：return sql`organizationId = ${ctx.orgId}`
  return sql`TRUE`;
}
```

**调用方**：
```ts
// src/app/api/admin/users/route.ts (新建 PR-8)
const filter = await adminVisibilityFilter();
const rows = await db.select().from(users).where(filter);
```

**为什么现在抽**：等 on-prem 真上线再加会到处补 WHERE，遗漏一处就是数据隔离漏洞。

---

### PR-7：bundle 验证 + on-prem CI

**目标**：CI 在每次 PR 自动验证 on-prem bundle 干净。

```ts
// scripts/verify-on-prem-bundle.ts (新增)
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const FORBIDDEN_SYMBOLS = [
  /\bstripe\b/i,        // Stripe SDK 类名 / endpoint
  /\bSTRIPE_/,          // 环境变量字面量
  /risk-?tier/i,        // risk-tier 逻辑
  /pg_advisory/i,       // 用作示例，可删
];

async function main() {
  const dir = '.open-next/worker';
  const files = await readdir(dir, { recursive: true });
  const offenders: string[] = [];
  for (const f of files) {
    if (!f.endsWith('.js')) continue;
    const content = await readFile(join(dir, f), 'utf8');
    for (const pattern of FORBIDDEN_SYMBOLS) {
      if (pattern.test(content)) offenders.push(`${f} contains ${pattern}`);
    }
  }
  if (offenders.length > 0) {
    console.error('on-prem bundle leaked SaaS-only symbols:');
    offenders.forEach(o => console.error('  ' + o));
    process.exit(1);
  }
  console.log('on-prem bundle clean.');
}
main();
```

`package.json`:
```json
"verify:on-prem": "DEPLOYMENT_MODE=on-prem pnpm build && tsx scripts/verify-on-prem-bundle.ts"
```

GitHub Actions：
```yaml
- name: Verify on-prem bundle does not leak SaaS code
  run: pnpm verify:on-prem
```

> **现实主义提醒**：完美 tree-shake 在 webpack 实际效果取决于 Next.js / OpenNext 的 minifier 行为。可能要接受 *变量名残留* 但函数体已删（grep `Stripe(` 而不是 `stripe`）。先跑一次看实际产物再决定 regex。

---

### PR-8：on-prem 占位路由 + i18n 命名空间

**目标**：scaffold `/admin/license` 和 `/admin/sso` 路由壳（"coming soon" 页面），SSO/license 的 i18n 命名空间建立。

```tsx
// src/app/[locale]/(dashboard)/admin/license/page.tsx (新建)
import { notFound } from 'next/navigation';
import { canShowLicense } from '@/lib/deployment-mode';

export default function LicensePage() {
  if (!canShowLicense()) notFound();
  return <div>License management — coming soon.</div>;
}
```

```tsx
// src/app/[locale]/(dashboard)/admin/sso/page.tsx (新建)
// 同上，谓词 canShowSsoConfig
```

**i18n 策略**：单文件 + 命名空间隔离，**不**做按模式动态加载。原因：

- 维护成本：拆 `billing.json` / `license.json` 后改一个组件可能要碰多个文件
- bundle 节省：翻译键平均 50 字节，SaaS 多带 20 个 on-prem 键 = ~1KB，不值得拆
- CI：`pnpm check:locales` 要在两种模式下都通过 — on-prem 加 `license.*` 键，SaaS 必须也有（即使没显示），避免运行时 "missing key" 警告

具体：
```json
// messages/en.json (增加片段)
{
  "admin": {
    "nav": {
      "overview": "Overview",
      "users": "Users",
      "aiBreaker": "AI Circuit Breaker",
      "riskTier": "Risk Tier",
      "billing": "Billing",
      "audit": "Audit Log",
      "license": "License",
      "sso": "Single Sign-On"
    }
  },
  "license": { "title": "License", "comingSoon": "Coming soon" },
  "sso": { "title": "Single Sign-On", "comingSoon": "Coming soon" }
}
```

---

### PR-9：ESLint 规则禁止直接读 DEPLOYMENT_MODE

**目标**：守护"零散落开关"验收标准。

```js
// eslint.config.mjs 增加
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/lib/deployment-mode.ts', 'next.config.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='DEPLOYMENT_MODE']",
        message: '直接读 DEPLOYMENT_MODE 被禁止 — 请用 @/lib/deployment-mode 的 helper',
      },
      {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='NEXT_PUBLIC_DEPLOYMENT_MODE']",
        message: '直接读 NEXT_PUBLIC_DEPLOYMENT_MODE 被禁止 — 请用 useDeploymentMode() hook',
      },
    ],
  },
}
```

---

### PR-10：测试套件双模式覆盖

**目标**：vitest 在两种模式下都跑。

```ts
// vitest.config.ts (修改)
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    test: {
      env: {
        DEPLOYMENT_MODE: env.DEPLOYMENT_MODE || 'saas', // 默认 saas
      },
      // ...
    },
  };
});
```

`package.json`:
```json
"test": "vitest",
"test:saas": "DEPLOYMENT_MODE=saas vitest run",
"test:on-prem": "DEPLOYMENT_MODE=on-prem vitest run",
"test:both": "pnpm test:saas && pnpm test:on-prem"
```

**测试编写模式**：模式特定测试用 `describe.skipIf`：
```ts
import { isSaaS } from '@/lib/deployment-mode';
describe.skipIf(!isSaaS())('Stripe webhook', () => { /* ... */ });
describe.skipIf(isSaaS())('License validator', () => { /* ... */ });
```

**模式切换测试**（mock helper）：
```ts
vi.mock('@/lib/deployment-mode', () => ({
  isSaaS: () => false,
  isOnPrem: () => true,
  canShowBilling: () => false,
  // ...
}));
```

---

## 4. 关键文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `src/lib/deployment-mode.ts` | **新建** | 单一 helper 入口 |
| `src/hooks/use-deployment-mode.ts` | **新建** | 客户端 hook |
| `next.config.ts` | 修改 | DefinePlugin 注入 `__DEPLOYMENT_MODE__` + `env` 镜像到 `NEXT_PUBLIC_*` |
| `src/lib/env-validation.ts` | 修改 | `requiredIn` 字段；按模式过滤 ENV_CHECKS |
| `src/app/[locale]/(dashboard)/admin/layout.tsx` | **新建** | admin 专属壳 + 按模式过滤导航 |
| `src/components/admin/admin-sidebar.tsx` | **新建** | NAV_ITEMS 数组 + canShow 谓词过滤 |
| `src/app/[locale]/(dashboard)/billing/page.tsx` | 修改 | `if (!canShowBilling()) notFound()` |
| `src/app/[locale]/pricing/page.tsx` | 修改 | `if (!canShowPricing()) notFound()` |
| `src/app/[locale]/(auth)/signup/page.tsx` | 修改 | `if (!canShowSignup()) notFound()` |
| `src/app/api/stripe/webhook/route.ts` | 修改 | gate by `canShowBilling()` |
| `src/app/api/stripe/portal/route.ts` | 修改 | gate by `canShowBilling()` |
| `src/app/api/stripe/checkout/route.ts` | 修改 | gate by `canShowBilling()` |
| `src/app/api/admin/risk-tier/route.ts` | 修改 | gate by `canShowRiskTier()` |
| `src/app/api/cron/risk-tier-decay/route.ts` | 修改 | gate by `canShowRiskTier()` |
| `src/app/api/user/dunning-status/route.ts` | 修改 | gate by `canShowBilling()` |
| `src/app/[locale]/(dashboard)/admin/risk-tier/page.tsx` | 修改 | gate by `canShowRiskTier()` |
| `src/lib/stripe.ts` | 修改 | 动态 `import('stripe')` + isSaaS 守门 |
| `src/lib/admin-scope.ts` | **新建** | `adminVisibilityFilter()` helper |
| `src/components/dashboard/sidebar.tsx` | 修改 | NAV_ITEMS + 模式过滤 |
| `src/app/[locale]/page.tsx` | 修改 | 变体组件按模式 |
| `src/components/marketing/hero.tsx` | **新建** | `SaasMarketingHero` + `OnPremMarketingHero` |
| `src/app/[locale]/(dashboard)/admin/license/page.tsx` | **新建** | 占位页 + gate |
| `src/app/[locale]/(dashboard)/admin/sso/page.tsx` | **新建** | 占位页 + gate |
| `messages/{en,zh,de}.json` | 修改 | 增加 `admin.nav.*`、`license.*`、`sso.*` 键 |
| `scripts/verify-on-prem-bundle.ts` | **新建** | bundle 泄漏检测 |
| `eslint.config.mjs` | 修改 | 禁用直接读 DEPLOYMENT_MODE |
| `vitest.config.ts` | 修改 | 注入 DEPLOYMENT_MODE 到测试 env |
| `package.json` | 修改 | 增加 `verify:on-prem`、`test:saas`、`test:on-prem` 脚本 |
| `.github/workflows/ci.yml` | 修改 | 增加 on-prem 构建 + bundle 验证步骤 |

---

## 5. 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| webpack tree-shake 不彻底，on-prem bundle 仍含 Stripe 字节 | PR-7 的 verify 脚本在 CI 拦截；可接受变量名残留但要求实际类/函数体已删 |
| Stripe SDK 通过 transitive dependency 被拉入（如某个监控库引用） | `pnpm why stripe` 在 on-prem 构建后审计；必要时 webpack `externals` 强排除 |
| 翻译键漂移 — on-prem 加键，SaaS 忘加 | `pnpm check:locales` 在两个 CI matrix 都跑 |
| 散落的 `process.env.DEPLOYMENT_MODE` 检查 | PR-9 ESLint 规则 + grep gate；CI 步骤 |
| 测试只跑 SaaS，on-prem 回归未发现 | PR-10 的 `test:both` 必须进 CI required-checks |
| 编译期常量在 SSR 与客户端值不一致 → hydration mismatch | DefinePlugin 同时设置 server 和 client；用 `NEXT_PUBLIC_*` 镜像 |
| on-prem 客户的 K3S 没有 Stripe webhook 路由，但有人扫到 `/api/stripe/webhook` 端点 | gate 返回 404 不是 200/500，无信息泄漏 |
| admin gate 错过某 SaaS-only 路由 → on-prem 客户能访问 Stripe portal | PR-4 的清单 + PR-7 的 bundle 验证（导入 stripe 会被检测） |
| 现有 SaaS 用户在 PR-1 后看到 `__DEPLOYMENT_MODE__` undefined → fallback 兜底 | helper 的 fallback = 'saas'；现有行为零变化 |
| 添加 `requiredIn` 后 SaaS dev 环境意外不提示 LICENSE_KEY 缺失 | dev 模式下两种模式都 warn 不 throw；只 production 严格 |

---

## 6. 验证步骤（合并前必跑）

```bash
# 1. SaaS 路径不变
pnpm build && pnpm test
curl -s http://localhost:3000/billing | head     # 应正常渲染
curl -s http://localhost:3000/api/stripe/checkout -X POST | head  # 应触达鉴权

# 2. on-prem 构建干净
DEPLOYMENT_MODE=on-prem pnpm build
pnpm verify:on-prem                              # 无泄漏

# 3. on-prem 路由 404
DEPLOYMENT_MODE=on-prem pnpm dev &
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/billing      # 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/pricing      # 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/risk-tier  # 404
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/admin/license    # 200 (占位)

# 4. 双模式测试
pnpm test:both

# 5. ESLint gate
pnpm lint  # 无 no-restricted-syntax 报错

# 6. i18n
pnpm check:locales:strict
```

---

## 7. SESSION_ID（供 /ccg:execute 使用）

- CODEX_SESSION: **(unavailable)** — codex CLI 配置错误（"gpt-5.1-codex model is not supported when using Codex with a ChatGPT account"），三次重试均失败。本计划由 Claude 单模型综合产出。
- GEMINI_SESSION: **(unavailable)** — 同上原因。

**执行影响**：`/ccg:execute` 阶段无法 `resume` 已有会话，必须新开会话（参数省略 `resume <SESSION_ID>` 即可）。一旦 codex CLI 配置修复（切换到 OpenAI API key 或选其它模型），后续 PR 的 review/audit 阶段可恢复多模型。
