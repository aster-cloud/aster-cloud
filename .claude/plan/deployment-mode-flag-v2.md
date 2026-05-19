# 实施计划 v2：deploymentMode 特性开关（SaaS / On-Prem）

> **🔖 已落地（2026-05）。架构决策摘要见
> [docs/architecture/decisions](../../docs/architecture/decisions/README.md)
> 的 ADR-0001 / 0002 / 0003。** 本文件保留为详细 plan 历史档案，新代码
> 改动只需理解 ADR 即可。
>
> 工作区：`/Users/rpang/IdeaProjects/aster-cloud`
> 日期：2026-05-18
> v2 修订基于 codex MCP 审查（session `019e387c-0c75-7e51-bcbd-4dfb3e96a201`）
>
> **v1 → v2 变更摘要**：
> - **C1**：暴露**编译期常量**（`IS_SAAS`、`CAN_BILLING`...），关键 gate 用常量；UI 用 helper —— v1 的纯函数谓词在跨模块场景下不能可靠 tree-shake
> - **C2**：on-prem 加 `webpack.resolve.alias.stripe = false` 硬阻断；不再只靠 `await import('stripe')` 死分支
> - **C3**：验证脚本扫 `.open-next/worker.js`（OpenNext 产物），不是 `pnpm build` 的中间物
> - **M1**：PR-7 的 tree-shake 验证**前置成 PR-1 的 blocking spike**，先证明可行再铺开
> - **M3**：vitest 改用 `projects` 单进程双 project，不再 `test:saas && test:on-prem` 双进程跑
> - **M4**：production on-prem 检测不到 `__DEPLOYMENT_MODE__` 必须 **fail-closed** throw，不能 fallback SaaS
> - **M5**：新增 PR-0 SaaS-only 服务全量清单（risk-tier-decay cron、emails、migrations、seed plans 等）
> - **m2**：`adminVisibilityFilter` 推迟到真有 org 边界再做（v2 从主线移除）

---

## 0. 任务类型

- [x] 前端 + 后端 + 构建配置 + CI（全栈）

---

## 1. 目标与验收标准

### 目标
一份源代码，两种发行版：

| 模式 | 命令 | 产物特征 |
|---|---|---|
| SaaS（现状） | `pnpm opennext:build`（默认 `DEPLOYMENT_MODE=saas`） | 含 Stripe / 风险评分 / 跨租户管理 / 自助注册 / Mixpanel / Resend |
| On-Prem | `DEPLOYMENT_MODE=on-prem pnpm opennext:build` | Stripe SDK / 风险评分 / 计费页 / 跨租户查询 / Mixpanel / 计费邮件 / 计费 cron 全部从 bundle 中**消失**；占位 license / SSO 路由 |

### 验收标准

1. **单源代码** — 不能 fork `*.saas.tsx` / `*.onprem.tsx`；差异通过 helper + 编译期常量折叠表达
2. **构建分离** — `DEPLOYMENT_MODE=on-prem pnpm opennext:build` 产物中：
   - `grep "from \"stripe\"\|require(\"stripe\")" .open-next/**/*.js` 应返回零匹配
   - `grep "STRIPE_SECRET_KEY\|STRIPE_WEBHOOK_SECRET" .open-next/**/*.js` 应返回零匹配
   - `grep "mixpanel\|MIXPANEL_TOKEN" .open-next/**/*.js` 应返回零匹配
3. **路由一致性** — on-prem 访问 `/pricing`、`/billing`、`/admin/risk-tier`、`/admin/billing`、`/api/stripe/*`、`/api/cron/risk-tier-decay` 应返回 404（不是 302、不是空白、不是 500）
4. **测试覆盖双模式** — `pnpm test` 通过 Vitest projects **一进程双 project** 跑，CI 时间不翻倍
5. **零散落开关** — `grep -rn "process.env.DEPLOYMENT_MODE\|__DEPLOYMENT_MODE__" src/` 应只命中 helper 模块本身（约 1-3 处）；其它所有判断走命名常量/谓词
6. **i18n 完整** — 两种构建下 `pnpm check:locales` 都通过
7. **env 校验** — `STRIPE_*` 在 on-prem 构建启动时**不报缺失**；`LICENSE_KEY` 在 SaaS 构建启动时**不报缺失**
8. **🔴 Fail-closed**：on-prem production 构建若 `__DEPLOYMENT_MODE__` 未注入，启动**立即 throw**，绝不 fallback SaaS（v1 的 fallback 行为是 fail-open 漏洞）
9. **回滚** — 移除 `DEPLOYMENT_MODE` 环境变量后 dev 默认 = SaaS，行为与 main 分支完全一致

---

## 2. 技术方案

### 2.1 分层架构（v2 修订）

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: 编译期常量（next.config.ts DefinePlugin）           │
│   __DEPLOYMENT_MODE__: 'saas' | 'on-prem'                    │
│   → Webpack/Turbopack 替换字面量；DCE 折叠死分支             │
└──────────────────────────────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 2: helper 模块（src/lib/deployment-mode.ts）           │
│                                                              │
│   2a. ★★★ 编译期常量 — DCE 敏感代码用 ★★★                  │
│       export const IS_SAAS  = __DEPLOYMENT_MODE__ === 'saas';│
│       export const IS_ONPREM = __DEPLOYMENT_MODE__ === 'on-prem'; │
│       export const CAN_BILLING   = IS_SAAS;                  │
│       export const CAN_PRICING   = IS_SAAS;                  │
│       export const CAN_RISKTIER  = IS_SAAS;                  │
│       export const CAN_SIGNUP    = IS_SAAS;                  │
│       export const CAN_MIXPANEL  = IS_SAAS;                  │
│       export const CAN_RESEND    = IS_SAAS;                  │
│       export const CAN_LICENSE   = IS_ONPREM;                │
│       export const CAN_SSO       = IS_ONPREM;                │
│                                                              │
│   2b. CAPABILITIES 对象 — UI 语义用                          │
│       export const CAPABILITIES = {                          │
│         billing:   CAN_BILLING,                              │
│         pricing:   CAN_PRICING,                              │
│         riskTier:  CAN_RISKTIER,                             │
│         signup:    CAN_SIGNUP,                               │
│         license:   CAN_LICENSE,                              │
│         sso:       CAN_SSO,                                  │
│       } as const;                                            │
│                                                              │
│   2c. Helper 函数 — 测试用（vi.mock 友好）                   │
│       export function getDeploymentMode() { ... }            │
│                                                              │
│   2d. ★★★ Fail-closed 启动断言 ★★★                          │
│       if (NODE_ENV === 'production' &&                      │
│           typeof __DEPLOYMENT_MODE__ === 'undefined') {     │
│         throw new Error('__DEPLOYMENT_MODE__ not injected'); │
│       }                                                      │
└──────────────────────────────────────────────────────────────┘
                       ↓
┌──────────────────────────────────────────────────────────────┐
│ Layer 3: 消费层                                              │
│   - 关键 gate（DCE 敏感）：if (!CAN_BILLING) notFound()      │
│   - UI 渲染（运行期）：CAPABILITIES.billing && <Item/>       │
│   - 测试：vi.mock('@/lib/deployment-mode', ...)              │
└──────────────────────────────────────────────────────────────┘
```

**为什么分两套 API**（v2 重大修订）：
- v1 的纯函数 `canShowBilling()` 在跨模块调用链中（`canShowBilling → isSaaS → getDeploymentMode`）Webpack 内联不可靠，特别是 Next.js / OpenNext 的 server chunks 跨边界打包后
- **编译期常量**（`CAN_BILLING`）被 webpack 直接看作字面量 `false`，`if (!false) ...` 必然 DCE
- **CAPABILITIES 对象**给 UI 用，可读性好但不依赖 DCE（UI 即使带上死分支也只是 ~几行 JSX，无 SDK 依赖）

### 2.2 数据流

```
process.env.DEPLOYMENT_MODE
       ↓ (next.config.ts 构建时读)
DefinePlugin → __DEPLOYMENT_MODE__ = 'saas' | 'on-prem' (字面量)
       ↓
src/lib/deployment-mode.ts
   ├─ IS_SAAS = (字面量 === 'saas')        ← 编译期布尔常量
   ├─ CAN_BILLING = IS_SAAS                ← 编译期布尔常量
   └─ CAPABILITIES = { billing: CAN_BILLING, ... }
       ↓
- route gate: if (!CAN_BILLING) notFound()           ← DCE 折叠
- module guard: if (!IS_SAAS) throw new Error()      ← DCE 折叠
- UI conditional: CAPABILITIES.billing && <Item/>    ← 运行期，OK
- next.config.ts webpack.resolve.alias:
    stripe: IS_ONPREM ? false : 'stripe'              ← 硬阻断 npm 包
```

### 2.3 反向不变量

| 不变量 | 由谁守护 |
|---|---|
| on-prem bundle 不含 Stripe / Mixpanel / Resend 字节码 | §10 bundle 验证脚本（扫 `.open-next/**/*.js`） |
| on-prem bundle 不能 `import 'stripe'` 等 SaaS-only npm 包 | `webpack.resolve.alias.stripe = false`（硬阻断） |
| 两种模式下所有页面有合法响应（200 或 404，无 500） | §8 E2E smoke test |
| on-prem production 必须 fail-closed（macro 未注入立刻 throw） | helper module 启动断言 |
| 翻译键无遗漏 | `pnpm check:locales` 在两种 vitest project 下都跑 |
| helper 是唯一开关访问点 | `pnpm lint`：自定义 ESLint 规则 |

---

## 3. 实施步骤（按 PR 顺序）

> **v2 最大变更**：原 PR-1 拆成 PR-1a（spike）+ PR-1b（落地）。先用一个最小 spike 在真实 OpenNext 产物上**证明** DefinePlugin + tree-shake 能传到 worker.js，否则整套架构不成立。

---

### PR-0：SaaS-only 服务全量清单（半天，纯文档）

**目标**：建立审计基线。在动任何代码前先穷举所有需要分模式的资产。

**产物**：`.claude/plan/saas-only-inventory.md`

| 类别 | 资产 | 路径示例 |
|---|---|---|
| 路由（页面） | `/billing`、`/pricing`、`/signup` | `src/app/[locale]/...` |
| 路由（API） | `/api/stripe/webhook`、`/api/stripe/portal`、`/api/stripe/checkout` | `src/app/api/stripe/*` |
| 路由（admin） | `/admin/risk-tier`、`/admin/billing` | `src/app/[locale]/(dashboard)/admin/*` |
| Cron jobs | `/api/cron/risk-tier-decay`、`/api/cron/trial-reminder`、`/api/cron/dunning`、`/api/cron/grace-period-cleanup` | `src/app/api/cron/*` |
| Libraries | `src/lib/stripe.ts`、`src/lib/dunning.ts`、`src/lib/risk-tier.ts`、`src/lib/plan-gate-client.ts`、`src/lib/stripe-reconcile.ts`、`src/lib/snapshot-pusher.ts` | `src/lib/` |
| Email templates | `src/lib/email/trial-ending.ts`、`src/lib/email/dunning-*.ts` | `src/lib/email/` |
| npm 依赖 | `stripe`、`mixpanel-browser`、`resend` | `package.json` |
| Env vars | `STRIPE_*`、`NEXT_PUBLIC_STRIPE_*`、`NEXT_PUBLIC_MIXPANEL_TOKEN`、`RESEND_API_KEY` | `src/lib/env-validation.ts` |
| DB 列/表 | `User.stripeCustomerId`、`User.subscriptionId`、`User.trial*`、`User.dunning*`、`User.gracePeriod*` | `src/db/schema.ts` |
| Seed 数据 | Stripe price IDs、SaaS plan limits | `src/scripts/seed-*.ts` |
| Webpack externals | `stripe`、`mixpanel-browser`、`resend` | `next.config.ts` |
| Wrangler scheduled | risk-tier-decay、trial-reminder cron triggers | `wrangler.toml` |

**On-prem 专属**（占位）：
| 资产 | 路径 |
|---|---|
| `/admin/license` | 占位页 |
| `/admin/sso` | 占位页 |
| `LICENSE_KEY`、`SSO_PROVIDER` env | `env-validation.ts` |

**验收**：清单合入主分支；下面所有 PR 的"清单"段落必须能对得上这个文件。

---

### PR-1a：BLOCKING SPIKE — 证明 OpenNext + DefinePlugin tree-shake 可行（1-2 天）

> **🚨 整个架构都依赖这个 spike 成立。失败则需要换方案（如运行时 + lazy import + 字段级排除）**

**目标**：在最简实验里证明：
1. `next.config.ts` 的 `webpack: (config) => ...` 回调中加 `DefinePlugin` → 注入 `__DEPLOYMENT_MODE__`
2. `pnpm opennext:build`（不是 `pnpm build`）跑通 OpenNext 工作流
3. 最终 `.open-next/worker.js` 里 `__DEPLOYMENT_MODE__` 已被替换为字面量
4. `if (!CAN_BILLING) ...` 死分支被 DCE 真正消除

**步骤**：
1. 临时分支 `spike/deployment-mode-tree-shake`
2. 加最小 helper：
   ```ts
   // src/lib/_spike-deployment-mode.ts
   declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';
   export const IS_SAAS = __DEPLOYMENT_MODE__ === 'saas';
   ```
3. 加最小消费点：
   ```ts
   // src/app/api/_spike/route.ts
   import { IS_SAAS } from '@/lib/_spike-deployment-mode';
   export async function GET() {
     if (!IS_SAAS) {
       return new Response('on-prem', { status: 200 });
     }
     // SaaS 专属：用一个明显的 marker 字符串方便 grep
     const SPIKE_MARKER_SAAS_ONLY = 'STRIPE_SPIKE_MARKER_42';
     return new Response(SPIKE_MARKER_SAAS_ONLY, { status: 200 });
   }
   ```
4. 加 DefinePlugin 到 next.config.ts
5. 跑：
   ```bash
   DEPLOYMENT_MODE=saas    pnpm opennext:build && cp -r .open-next .open-next-saas
   DEPLOYMENT_MODE=on-prem pnpm opennext:build && cp -r .open-next .open-next-onprem
   ```
6. **验证**：
   ```bash
   grep "STRIPE_SPIKE_MARKER_42" .open-next-saas/**/*.js   # 应找到
   grep "STRIPE_SPIKE_MARKER_42" .open-next-onprem/**/*.js # 必须找不到
   ```
7. 同时验证 `await import('stripe')` 在 on-prem 死分支里是否会被 OpenNext server tracing 拉入

**spike 输出**：在 `.claude/plan/deployment-mode-spike-report.md` 记录：
- 哪些消费模式 DCE 成功（直接 `IS_SAAS` 常量？经函数包装？经对象成员？）
- OpenNext 是否需要额外配置才能传 DefinePlugin
- `await import('stripe')` 在死分支的实际行为
- 是否需要 `webpack.resolve.alias.stripe = false` 才能完全排除

**决策门**（基于 spike 结果）：
- ✅ **通过**：继续 PR-1b 落地正式 helper
- ⚠️ **部分通过**：调整 helper API（如某些消费模式需要直接字面量而不是常量）
- ❌ **失败**：转方案 B —— 接受运行时 gate + lazy import + 显式 `webpack.externals` 排除 SaaS-only npm 包，不再追求 DCE

> spike 分支用完即弃，不合入主线。

---

### PR-1b：核心 helper（基于 spike 结果落地）

**目标**：基于 spike 报告的发现，落地正式 helper API。

```ts
// src/lib/deployment-mode.ts
declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';

// ─── 2d. Fail-closed 启动断言 ────────────────────────────
// 在 production 中 macro 必须被 DefinePlugin 替换；如果走到这一行
// 说明编译期注入失败，绝对不能 fallback 到 SaaS 偷偷开启计费路径。
if (
  typeof __DEPLOYMENT_MODE__ === 'undefined' &&
  process.env.NODE_ENV === 'production'
) {
  throw new Error(
    '[deployment-mode] __DEPLOYMENT_MODE__ was not compiled into the build. ' +
      'Check next.config.ts DefinePlugin wiring.',
  );
}

// dev / test fallback — 只在非 production 生效
const _RUNTIME: 'saas' | 'on-prem' =
  typeof __DEPLOYMENT_MODE__ !== 'undefined'
    ? __DEPLOYMENT_MODE__
    : process.env.DEPLOYMENT_MODE === 'on-prem'
      ? 'on-prem'
      : 'saas';

// ─── 2a. 编译期常量 — DCE 敏感代码用 ─────────────────────
export const IS_SAAS = _RUNTIME === 'saas';
export const IS_ONPREM = _RUNTIME === 'on-prem';

export const CAN_BILLING   = IS_SAAS;
export const CAN_PRICING   = IS_SAAS;
export const CAN_RISKTIER  = IS_SAAS;
export const CAN_SIGNUP    = IS_SAAS;
export const CAN_MIXPANEL  = IS_SAAS;
export const CAN_RESEND    = IS_SAAS;
export const CAN_DUNNING   = IS_SAAS;
export const CAN_LICENSE   = IS_ONPREM;
export const CAN_SSO       = IS_ONPREM;

// ─── 2b. CAPABILITIES — UI / runtime 语义用 ─────────────
export const CAPABILITIES = {
  billing:   CAN_BILLING,
  pricing:   CAN_PRICING,
  riskTier:  CAN_RISKTIER,
  signup:    CAN_SIGNUP,
  mixpanel:  CAN_MIXPANEL,
  resend:    CAN_RESEND,
  dunning:   CAN_DUNNING,
  license:   CAN_LICENSE,
  sso:       CAN_SSO,
} as const;

export type DeploymentMode = 'saas' | 'on-prem';

// ─── 2c. Helper — 测试 / 兜底访问 ───────────────────────
export function getDeploymentMode(): DeploymentMode {
  return _RUNTIME;
}
```

```ts
// next.config.ts (新增片段)
import webpack from 'webpack';

const mode: 'saas' | 'on-prem' =
  process.env.DEPLOYMENT_MODE === 'on-prem' ? 'on-prem' : 'saas';

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.plugins.push(
      new webpack.DefinePlugin({
        __DEPLOYMENT_MODE__: JSON.stringify(mode),
      }),
    );

    // ★ Critical (C2) 硬阻断：on-prem 解析到 SaaS-only npm 包直接报错
    if (mode === 'on-prem') {
      config.resolve = config.resolve || {};
      config.resolve.alias = {
        ...(config.resolve.alias || {}),
        stripe: false,
        'mixpanel-browser': false,
        resend: false,
      };
    }
    return config;
  },
  env: {
    NEXT_PUBLIC_DEPLOYMENT_MODE: mode,
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

// 客户端 CAPABILITIES（值与服务端一致，因为同一 build 时常量）
export const CLIENT_CAPABILITIES = {
  billing:  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'saas',
  pricing:  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'saas',
  signup:   process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'saas',
  license:  process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'on-prem',
  sso:      process.env.NEXT_PUBLIC_DEPLOYMENT_MODE === 'on-prem',
};
```

**测试**：单元测试 mock helper（`vi.mock('@/lib/deployment-mode', () => ({ IS_SAAS: false, IS_ONPREM: true, CAN_BILLING: false, ... }))`），验证 SaaS / on-prem 行为切换。

---

### PR-2：env-validation 接入 deployment-mode

**目标**：让 `ENV_CHECKS` 按模式声明。

```ts
// src/lib/env-validation.ts (修改)
import { IS_SAAS, IS_ONPREM } from './deployment-mode';

type EnvCheck = {
  key: string;
  required: 'always' | 'production-only';
  requiredIn?: ReadonlyArray<'saas' | 'on-prem'>; // 默认 ['saas','on-prem']
  description: string;
};

const ENV_CHECKS: readonly EnvCheck[] = [
  // 两种都要
  { key: 'DATABASE_URL', required: 'always', description: '...' },
  { key: 'AUTH_SECRET',  required: 'production-only', description: '...' },
  { key: 'CRON_SECRET',  required: 'production-only', description: '...' },

  // SaaS 专属
  { key: 'STRIPE_SECRET_KEY',                       required: 'production-only', requiredIn: ['saas'], description: '...' },
  { key: 'STRIPE_WEBHOOK_SECRET',                   required: 'production-only', requiredIn: ['saas'], description: '...' },
  { key: 'NEXT_PUBLIC_STRIPE_PRO_MONTHLY_PRICE_ID', required: 'production-only', requiredIn: ['saas'], description: '...' },
  // ... 其它 Stripe price IDs
  { key: 'NEXT_PUBLIC_MIXPANEL_TOKEN',              required: 'production-only', requiredIn: ['saas'], description: '...' },
  { key: 'RESEND_API_KEY',                          required: 'production-only', requiredIn: ['saas'], description: '...' },

  // On-Prem 专属
  { key: 'LICENSE_KEY',     required: 'production-only', requiredIn: ['on-prem'], description: 'Aster Enterprise license key' },
  { key: 'SSO_PROVIDER',    required: 'production-only', requiredIn: ['on-prem'], description: 'SAML / OIDC provider id' },
];

export function checkEnv(env = process.env): ValidationResult {
  const mode = IS_SAAS ? 'saas' : 'on-prem';
  for (const check of ENV_CHECKS) {
    if (check.requiredIn && !check.requiredIn.includes(mode)) continue;
    // ... existing missing/warning logic
  }
}
```

---

### PR-3：admin shell 抽出

**目标**：建立 `/admin/*` 专属布局，为按模式过滤 admin 子页做准备。

```tsx
// src/app/[locale]/(dashboard)/admin/layout.tsx (新增)
import { redirect } from 'next/navigation';
import { isAdminFromSession } from '@/lib/admin-auth';
import { IS_SAAS } from '@/lib/deployment-mode';
import { AdminSidebar } from '@/components/admin/admin-sidebar';
import { getTranslations } from 'next-intl/server';

export default async function AdminLayout({ children, params }) {
  const { locale } = await params;
  const ctx = await isAdminFromSession();
  if (!ctx) redirect(`/${locale}/dashboard`);

  const t = await getTranslations('admin');

  return (
    <div className="grid grid-cols-[240px_1fr] min-h-screen">
      <AdminSidebar t={t} />
      <main className="p-6">
        <header className="mb-4 flex items-center gap-2">
          <span className="rounded bg-red-100 text-red-900 px-2 py-0.5 text-xs font-semibold">
            {IS_SAAS ? 'ADMIN CONSOLE — SaaS' : 'ADMIN CONSOLE — On-Prem'}
          </span>
        </header>
        {children}
      </main>
    </div>
  );
}
```

```tsx
// src/components/admin/admin-sidebar.tsx
import {
  CAN_BILLING,
  CAN_RISKTIER,
  CAN_LICENSE,
  CAN_SSO,
} from '@/lib/deployment-mode';

type NavItem = {
  href: string;
  labelKey: string;
  show: boolean; // ← v2: 常量，不是函数
};

const ADMIN_NAV: NavItem[] = [
  { href: '/admin',                    labelKey: 'nav.overview',  show: true },
  { href: '/admin/users',              labelKey: 'nav.users',     show: true },
  { href: '/admin/ai-circuit-breaker', labelKey: 'nav.aiBreaker', show: true },
  { href: '/admin/risk-tier',          labelKey: 'nav.riskTier',  show: CAN_RISKTIER },
  { href: '/admin/billing',            labelKey: 'nav.billing',   show: CAN_BILLING },
  { href: '/admin/audit-log',          labelKey: 'nav.audit',     show: true },
  { href: '/admin/license',            labelKey: 'nav.license',   show: CAN_LICENSE },
  { href: '/admin/sso',                labelKey: 'nav.sso',       show: CAN_SSO },
];

export function AdminSidebar({ t }) {
  const items = ADMIN_NAV.filter(i => i.show);
  return (
    <nav className="border-r p-4 space-y-1">
      {items.map(item => (
        <Link key={item.href} href={item.href}>{t(item.labelKey)}</Link>
      ))}
    </nav>
  );
}
```

---

### PR-4：包裹现有 SaaS-only 页面 / API（按 PR-0 清单逐项）

**目标**：每个 SaaS 专属路由用编译期常量守门，on-prem 自动 404。

**统一模式**（route 必须用**常量直接条件**，不要套函数）：

```tsx
// src/app/[locale]/(dashboard)/billing/page.tsx
import { notFound } from 'next/navigation';
import { CAN_BILLING } from '@/lib/deployment-mode';

export default async function BillingPage() {
  if (!CAN_BILLING) notFound(); // ← 字面量条件，DCE 友好
  // ... existing
}
```

```ts
// src/app/api/stripe/webhook/route.ts
import { NextResponse } from 'next/server';
import { CAN_BILLING } from '@/lib/deployment-mode';

export async function POST(req: Request) {
  if (!CAN_BILLING) return new NextResponse(null, { status: 404 });
  // ... existing Stripe webhook logic
}
```

**Stripe SDK 加载模式**（C2 修订 — 双保险）：

```ts
// src/lib/stripe.ts
import { IS_SAAS } from '@/lib/deployment-mode';

let _stripe: import('stripe').Stripe | null = null;
export async function getStripe() {
  if (!IS_SAAS) {
    throw new Error('Stripe unavailable in on-prem build');
  }
  if (!_stripe) {
    const { default: Stripe } = await import('stripe');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2024-06-20',
    });
  }
  return _stripe;
}
```

> **C2 双保险**：源码里 `await import('stripe')` 即使在死分支也保留，但 `next.config.ts` 的 `webpack.resolve.alias.stripe = false`（on-prem 模式）让 bundler 在解析时就**找不到** stripe 模块——双重保证。

**完整 PR-4 待包裹清单**（基于 PR-0 inventory，按模块批次）：

| 批次 | 路径 | 常量 |
|---|---|---|
| Pages | `src/app/[locale]/(dashboard)/billing/page.tsx` | `CAN_BILLING` |
| Pages | `src/app/[locale]/pricing/page.tsx` | `CAN_PRICING` |
| Pages | `src/app/[locale]/(auth)/signup/page.tsx` | `CAN_SIGNUP` |
| Pages | `src/app/[locale]/(dashboard)/admin/risk-tier/page.tsx` | `CAN_RISKTIER` |
| API | `src/app/api/stripe/webhook/route.ts` | `CAN_BILLING` |
| API | `src/app/api/stripe/portal/route.ts` | `CAN_BILLING` |
| API | `src/app/api/stripe/checkout/route.ts` | `CAN_BILLING` |
| API | `src/app/api/admin/risk-tier/route.ts` | `CAN_RISKTIER` |
| API | `src/app/api/user/dunning-status/route.ts` | `CAN_DUNNING` |
| Cron | `src/app/api/cron/risk-tier-decay/route.ts` | `CAN_RISKTIER` |
| Cron | `src/app/api/cron/trial-reminder/route.ts` | `CAN_BILLING` |
| Cron | `src/app/api/cron/dunning/route.ts` | `CAN_DUNNING` |
| Cron | `src/app/api/cron/grace-period-cleanup/route.ts` | `CAN_DUNNING` |
| Email | `src/lib/email/trial-ending.ts` 等所有 Resend 调用 | `CAN_RESEND` |
| Mixpanel | `src/lib/telemetry/*.ts`（如有） | `CAN_MIXPANEL` |

---

### PR-5：导航 + 客户端组件按模式渲染

**目标**：dashboard sidebar、用户菜单、登录页等客户端 UI 按模式隐藏。

```tsx
// src/components/dashboard/sidebar.tsx
'use client';
import { CLIENT_CAPABILITIES } from '@/hooks/use-deployment-mode';

type NavItem = {
  href: string;
  label: string;
  show: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'home',     show: true },
  { href: '/policies',  label: 'policies', show: true },
  { href: '/billing',   label: 'billing',  show: CLIENT_CAPABILITIES.billing },
  { href: '/pricing',   label: 'upgrade',  show: CLIENT_CAPABILITIES.pricing },
];

export function Sidebar() {
  return <nav>{NAV_ITEMS.filter(i => i.show).map(...)}</nav>;
}
```

**用户菜单**：
```tsx
{CLIENT_CAPABILITIES.billing && <MenuItem href="/billing">{t('manageSubscription')}</MenuItem>}
{CLIENT_CAPABILITIES.license && <MenuItem href="/admin/license">{t('licenseStatus')}</MenuItem>}
```

**marketing home `/`** — 变体组件：
```tsx
// src/app/[locale]/page.tsx
import { IS_SAAS } from '@/lib/deployment-mode';
import { SaasMarketingHero, OnPremMarketingHero } from '@/components/marketing/hero';

export default function Home() {
  return IS_SAAS ? <SaasMarketingHero /> : <OnPremMarketingHero />;
}
```

---

### ~~PR-6：tenant 作用域抽象~~（v2 移除 — YAGNI）

**v2 决策**：codex 审查 m2 指出 `adminVisibilityFilter()` 在两种模式都返 `TRUE` 是 YAGNI 且**给一种虚假的隔离感**。推迟到真有 org/deployment 边界时再做。

PR-6 从主线移除。如果未来 on-prem 支持单部署多 org，再起新 PR 实现真正的 visibility filter + 测试证明数据隔离。

---

### PR-7：bundle 验证 + on-prem CI

> **v2 重大修订**：扫描目标改成 `.open-next/**/*.js`（OpenNext 产物），不是 `pnpm build` 的中间物；规则区分"硬禁止"和"良性字符串"。

```ts
// scripts/verify-on-prem-bundle.ts
import { readFile } from 'node:fs/promises';
import { glob } from 'glob';

// 硬禁止：这些出现一次都失败
const FORBIDDEN_IMPORTS = [
  /from\s+["']stripe["']/,                  // ESM import
  /require\(["']stripe["']\)/,              // CJS import
  /from\s+["']mixpanel-browser["']/,
  /require\(["']mixpanel-browser["']\)/,
  /from\s+["']resend["']/,
  /require\(["']resend["']\)/,
];

// 硬禁止：环境变量字面量出现（说明代码路径还在）
const FORBIDDEN_ENV_LITERALS = [
  /STRIPE_SECRET_KEY/,
  /STRIPE_WEBHOOK_SECRET/,
  /NEXT_PUBLIC_MIXPANEL_TOKEN/,
  /RESEND_API_KEY/,
];

// 允许的良性字符串（变量名 / 注释残留 OK，不算泄漏）
const BENIGN_PATTERNS = [
  /\/\/.*stripe/i,            // 注释里提到
  /\bstripeCustomerId\b/,     // DB 列名（schema 中存在但不调用 SDK）
];

async function main() {
  const files = await glob('.open-next/**/*.js');
  const offenders: { file: string; pattern: RegExp; line: string }[] = [];

  for (const f of files) {
    const content = await readFile(f, 'utf8');
    for (const pattern of [...FORBIDDEN_IMPORTS, ...FORBIDDEN_ENV_LITERALS]) {
      const matches = content.match(pattern);
      if (!matches) continue;
      // 找出包含 match 的整行；如全部命中良性模式则放行
      const matchLine = content.split('\n').find(l => pattern.test(l)) ?? matches[0];
      const isBenign = BENIGN_PATTERNS.some(p => p.test(matchLine));
      if (!isBenign) offenders.push({ file: f, pattern, line: matchLine.trim() });
    }
  }

  if (offenders.length > 0) {
    console.error(`on-prem bundle leaked ${offenders.length} SaaS-only symbol(s):`);
    offenders.slice(0, 20).forEach(o => {
      console.error(`  ${o.file}: ${o.pattern} → ${o.line.slice(0, 200)}`);
    });
    process.exit(1);
  }
  console.log(`on-prem bundle clean (${files.length} files scanned).`);
}

main();
```

`package.json`:
```json
"opennext:build":  "next build && opennextjs-cloudflare build --skipNextBuild",
"verify:on-prem":  "DEPLOYMENT_MODE=on-prem pnpm opennext:build && tsx scripts/verify-on-prem-bundle.ts",
"verify:packages": "DEPLOYMENT_MODE=on-prem pnpm opennext:build && pnpm why stripe || true && pnpm why mixpanel-browser || true && pnpm why resend || true"
```

GitHub Actions：
```yaml
- name: Verify on-prem bundle does not leak SaaS code
  run: pnpm verify:on-prem

- name: Audit transitive deps in on-prem build
  run: pnpm verify:packages
```

---

### PR-8：on-prem 占位路由 + i18n

**目标**：scaffold `/admin/license` 和 `/admin/sso` 路由壳，i18n 键齐全。

```tsx
// src/app/[locale]/(dashboard)/admin/license/page.tsx
import { notFound } from 'next/navigation';
import { CAN_LICENSE } from '@/lib/deployment-mode';

export default function LicensePage() {
  if (!CAN_LICENSE) notFound();
  return <div>License management — coming soon.</div>;
}
```

**i18n 策略**（v2 微调）：单文件，但**约束**模式专属页不能在条件 missing key 上引用 — 由 `pnpm check:locales:strict` 守门。

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
  "sso":     { "title": "Single Sign-On", "comingSoon": "Coming soon" }
}
```

---

### PR-9：ESLint 规则禁止直接读 DEPLOYMENT_MODE

```js
// eslint.config.mjs
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/lib/deployment-mode.ts', 'src/hooks/use-deployment-mode.ts', 'next.config.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='DEPLOYMENT_MODE']",
        message: '直接读 DEPLOYMENT_MODE 被禁止 — 请用 @/lib/deployment-mode 的常量/谓词',
      },
      {
        selector: "MemberExpression[object.object.name='process'][object.property.name='env'][property.name='NEXT_PUBLIC_DEPLOYMENT_MODE']",
        message: '直接读 NEXT_PUBLIC_DEPLOYMENT_MODE 被禁止 — 请用 @/hooks/use-deployment-mode',
      },
      {
        selector: "Identifier[name='__DEPLOYMENT_MODE__']",
        message: '直接引用 __DEPLOYMENT_MODE__ 被禁止 — 请用 @/lib/deployment-mode 的导出',
      },
    ],
  },
}
```

---

### PR-10：测试套件双模式覆盖（v2 — Vitest projects）

> **v2 重大修订**：用 Vitest projects 单进程双 project，CI 时间几乎不增加。

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'saas',
          env: { DEPLOYMENT_MODE: 'saas' },
        },
      },
      {
        extends: true,
        test: {
          name: 'on-prem',
          env: { DEPLOYMENT_MODE: 'on-prem' },
        },
      },
    ],
  },
});
```

`package.json`:
```json
"test":          "vitest",
"test:run":      "vitest run",
"test:saas":     "vitest run --project saas",
"test:on-prem":  "vitest run --project on-prem"
```

**模式特定测试**（用 `it.skipIf` 而不是 `describe.skipIf`，import 时求值更稳）：
```ts
import { it, describe } from 'vitest';
import { IS_SAAS } from '@/lib/deployment-mode';

describe('Stripe webhook', () => {
  it.skipIf(!IS_SAAS)('rejects unsigned payload', () => { /* ... */ });
});

describe('License validator', () => {
  it.skipIf(IS_SAAS)('validates license key signature', () => { /* ... */ });
});
```

**模式切换测试**（mock helper）：
```ts
vi.mock('@/lib/deployment-mode', () => ({
  IS_SAAS: false,
  IS_ONPREM: true,
  CAN_BILLING: false,
  CAN_RISKTIER: false,
  CAN_LICENSE: true,
  CAPABILITIES: { billing: false, riskTier: false, license: true /* ... */ },
}));
```

---

## 4. 关键文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `.claude/plan/saas-only-inventory.md` | **新建** | PR-0 产物 |
| `.claude/plan/deployment-mode-spike-report.md` | **新建** | PR-1a 产物 |
| `src/lib/deployment-mode.ts` | **新建** | 编译期常量 + CAPABILITIES + fail-closed |
| `src/hooks/use-deployment-mode.ts` | **新建** | 客户端 hook + CLIENT_CAPABILITIES |
| `next.config.ts` | 修改 | DefinePlugin + on-prem `resolve.alias` 硬阻断 |
| `src/lib/env-validation.ts` | 修改 | `requiredIn` 字段 |
| `src/app/[locale]/(dashboard)/admin/layout.tsx` | **新建** | admin 专属壳 |
| `src/components/admin/admin-sidebar.tsx` | **新建** | NAV_ITEMS 常量过滤 |
| `src/app/[locale]/(dashboard)/billing/page.tsx` | 修改 | `if (!CAN_BILLING) notFound()` |
| `src/app/[locale]/pricing/page.tsx` | 修改 | `if (!CAN_PRICING) notFound()` |
| `src/app/[locale]/(auth)/signup/page.tsx` | 修改 | `if (!CAN_SIGNUP) notFound()` |
| `src/app/api/stripe/*/route.ts` | 修改 (×3) | `CAN_BILLING` gate |
| `src/app/api/admin/risk-tier/route.ts` | 修改 | `CAN_RISKTIER` gate |
| `src/app/api/cron/risk-tier-decay/route.ts` | 修改 | `CAN_RISKTIER` gate |
| `src/app/api/cron/trial-reminder/route.ts` | 修改 | `CAN_BILLING` gate |
| `src/app/api/cron/dunning/route.ts` | 修改 | `CAN_DUNNING` gate |
| `src/app/api/cron/grace-period-cleanup/route.ts` | 修改 | `CAN_DUNNING` gate |
| `src/app/api/user/dunning-status/route.ts` | 修改 | `CAN_DUNNING` gate |
| `src/app/[locale]/(dashboard)/admin/risk-tier/page.tsx` | 修改 | `CAN_RISKTIER` gate |
| `src/lib/stripe.ts` | 修改 | `IS_SAAS` 守门 + 动态 import |
| `src/lib/email/trial-ending.ts` 等 | 修改 | `CAN_RESEND` gate |
| `src/components/dashboard/sidebar.tsx` | 修改 | NAV_ITEMS + `CLIENT_CAPABILITIES` |
| `src/app/[locale]/page.tsx` | 修改 | 变体组件按 `IS_SAAS` |
| `src/components/marketing/hero.tsx` | **新建** | `SaasMarketingHero` + `OnPremMarketingHero` |
| `src/app/[locale]/(dashboard)/admin/license/page.tsx` | **新建** | 占位页 + gate |
| `src/app/[locale]/(dashboard)/admin/sso/page.tsx` | **新建** | 占位页 + gate |
| `messages/{en,zh,de}.json` | 修改 | `admin.nav.*`、`license.*`、`sso.*` |
| `scripts/verify-on-prem-bundle.ts` | **新建** | bundle 泄漏检测（扫 `.open-next/`） |
| `eslint.config.mjs` | 修改 | 禁用直接读 DEPLOYMENT_MODE |
| `vitest.config.ts` | 修改 | 双 project 配置 |
| `package.json` | 修改 | 增加 `opennext:build` / `verify:on-prem` / `verify:packages` / `test:saas` / `test:on-prem` |
| `.github/workflows/ci.yml` | 修改 | 增加 on-prem 构建 + bundle 验证 + 双 project 测试 |

---

## 5. 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| **C1** Webpack 不能跨模块函数调用折叠 → tree-shake 失败 | **v2**：暴露编译期常量 `CAN_BILLING`；route gate 用常量条件 |
| **C2** `await import('stripe')` 在死分支仍被 OpenNext server tracing 拉入 | **v2**：`webpack.resolve.alias.stripe = false` 在 on-prem 模式硬阻断（双保险） |
| **C3** 验证脚本扫错文件（`pnpm build` 不出 worker.js） | **v2**：脚本改用 `pnpm opennext:build`，扫 `.open-next/**/*.js` |
| **M1** OpenNext 不一定尊重 `next.config.ts` webpack 回调 | **v2 PR-1a blocking spike**：先在真实产物上证明可行；失败转方案 B（运行时 + lazy + externals） |
| **M3** vitest 双跑翻倍 CI 时间 | **v2**：Vitest projects 单进程跑 |
| **M4** on-prem production 未注入 macro 时 fallback SaaS（**fail-open 漏洞**） | **v2**：helper 启动断言 `NODE_ENV==='production' && typeof macro === 'undefined' → throw` |
| **M5** SaaS-only 资产清单不完整（cron、emails、Mixpanel...） | **v2 PR-0**：先穷举清单再开始改代码 |
| Stripe transitive deps（监控库等）拉入 | `pnpm verify:packages` 步骤跑 `pnpm why stripe` 审计 |
| 翻译键漂移 | `pnpm check:locales` 在两种 vitest project 下都跑 |
| 散落的 `process.env.DEPLOYMENT_MODE` 检查 | PR-9 ESLint 规则 |
| SSR 与客户端值不一致 → hydration mismatch | DefinePlugin 同时设置 server 和 client；用 `NEXT_PUBLIC_*` 镜像 |
| on-prem 客户被扫到 `/api/stripe/webhook` | gate 返回 404 不是 200/500，无信息泄漏 |
| 现有 SaaS 用户在 PR-1b 后行为变化 | fallback 仅 dev/test 生效；production 失败硬 throw，强制 CI 注入 macro |

---

## 6. 验证步骤（合并前必跑）

```bash
# 0. SaaS 路径不变
DEPLOYMENT_MODE=saas pnpm opennext:build
pnpm test:saas

# 1. on-prem 构建成功且 bundle 干净
DEPLOYMENT_MODE=on-prem pnpm opennext:build
pnpm verify:on-prem
pnpm verify:packages  # pnpm why stripe / mixpanel-browser / resend 应无依赖路径

# 2. on-prem 路由 404（用本地 wrangler dev）
DEPLOYMENT_MODE=on-prem pnpm preview &  # wrangler dev
sleep 5
for path in /billing /pricing /signup /admin/risk-tier /admin/billing /api/stripe/webhook /api/cron/risk-tier-decay; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8787${path})
  echo "${path}: ${code} (expect 404)"
done

# 3. on-prem 占位路由 200
for path in /admin/license /admin/sso; do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8787${path})
  echo "${path}: ${code} (expect 200)"
done

# 4. 双模式测试（一进程双 project）
pnpm test:run

# 5. ESLint gate
pnpm lint

# 6. i18n
pnpm check:locales:strict

# 7. Fail-closed 验证（手动）
#   注释掉 next.config.ts 的 DefinePlugin
#   DEPLOYMENT_MODE=on-prem NODE_ENV=production pnpm opennext:build
#   预期：启动时抛 "__DEPLOYMENT_MODE__ was not compiled into the build"
```

---

## 7. PR 依赖图

```
PR-0 (inventory)
  ↓
PR-1a (spike — BLOCKING)
  ↓
PR-1b (helper)
  ├─→ PR-2 (env-validation)
  ├─→ PR-3 (admin shell)
  ├─→ PR-4 (gate SaaS routes) ── 依赖 PR-0 清单
  ├─→ PR-5 (UI nav)
  ├─→ PR-7 (verify script + CI) ── 必须在 PR-4 之后才能验证有效
  ├─→ PR-8 (placeholder routes + i18n)
  ├─→ PR-9 (ESLint)
  └─→ PR-10 (vitest projects)
```

**关键路径**：PR-0 → PR-1a → PR-1b → PR-4 → PR-7。其它 PR 可并行。

---

## 8. SESSION_ID

- **审查 SESSION_ID**：`019e387c-0c75-7e51-bcbd-4dfb3e96a201`（codex MCP, gpt-5.1-codex；可用 `/ccg:execute resume <SESSION_ID>` 复用以保持上下文一致）
- **v1 计划 codex/gemini 会话**：不可用（CLI 配置问题三次失败），v1 由 Claude 单模型综合产出
- **v2 升级**：基于 codex MCP 审查反馈，由 Claude 合入

---

## 9. v1 → v2 修订对照

| codex 反馈 ID | 类别 | v1 行为 | v2 修订 |
|---|---|---|---|
| C1 | Critical | `canShowBilling()` 函数包装 | `CAN_BILLING` 编译期常量 + `CAPABILITIES` 双 API |
| C2 | Critical | 仅靠 `await import('stripe')` 死分支 | 加 `webpack.resolve.alias.stripe = false` 硬阻断 |
| C3 | Critical | `grep .open-next/worker.js`（前提是 `pnpm build` 出此文件） | 显式 `pnpm opennext:build` + 扫 `.open-next/**/*.js` |
| M1 | Major | PR-7 末位验证 tree-shake | **PR-1a blocking spike** 先证后做 |
| M2 | Major | 谓词函数群 | 编译期常量 + CAPABILITIES 对象 |
| M3 | Major | `test:saas && test:on-prem` 双进程 | Vitest projects 单进程 |
| M4 | Major | fallback = SaaS（fail-open） | production 必须 fail-closed throw |
| M5 | Major | 清单不完整 | 新增 PR-0 穷举 SaaS-only 资产 |
| m1 | Minor | i18n 单文件理由是"1KB 不值得拆" | 维持单文件，补充 `check:locales:strict` |
| m2 | Minor | PR-6 `adminVisibilityFilter` 返回 TRUE | **v2 移除 PR-6**（YAGNI） |
| m3 | Minor | grep regex 太窄 | 区分 FORBIDDEN_IMPORTS / FORBIDDEN_ENV_LITERALS / BENIGN_PATTERNS |
| S1 | Suggestion | tree-shake 验证在 PR-7 | 提前到 PR-1a |
| S2 | Suggestion | — | 加 `pnpm why stripe` 审计步骤 |
| S3 | Suggestion | — | 两套 API 已在 §2.1 文档化 |
