# PR-1a Spike Report: DefinePlugin + DCE Verification

> 工作区：`/Users/rpang/IdeaProjects/aster-cloud`
> 分支：`spike/deployment-mode-tree-shake`
> 日期：2026-05-18
> 决策门：**通过（带条件）** —— v2 计划方案成立，但需在 PR-1b 调整 helper API 设计

---

## 1. 实验设置

- **Webpack bundler**：Next.js 15.5.12 内置（OpenNext 跑 `next build`，不重打包 server chunks）
- **OpenNext**：1.19.10（`@opennextjs/cloudflare`）
- **构建命令**：`pnpm build` = `next build && opennextjs-cloudflare build --skipNextBuild`（v2 计划写的 `pnpm opennext:build` 就是这个）

**注入点**（`next.config.ts`）：

```ts
const DEPLOYMENT_MODE = process.env.DEPLOYMENT_MODE === 'on-prem' ? 'on-prem' : 'saas';

webpack: (config, { webpack }) => {
  config.plugins.push(
    new webpack.DefinePlugin({
      __DEPLOYMENT_MODE__: JSON.stringify(DEPLOYMENT_MODE),
    }),
  );
  // 仅 on-prem 模式
  if (DEPLOYMENT_MODE === 'on-prem') {
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      stripe: false,
    };
  }
  return config;
},
```

> 用 Next 传入的 `webpack` 实例避免额外依赖；不能用 top-level `import webpack from 'webpack'`（types 未装）

**关键路径**：`src/lib/_spike-deployment-mode.ts` 暴露 `IS_SAAS`；三个 spike route 验证不同消费模式。

> 顺便发现：Next.js App Router 把 `_` 前缀的目录当**私有目录**忽略（不走路由）。所有 spike route 必须用普通命名（`spike/`，不是 `_spike/`）。

---

## 2. 三个 spike route + 三种消费模式

| Route | 消费模式 | DCE 期望 |
|---|---|---|
| `GET /api/spike` | `if (!IS_SAAS) return ...; const MARKER = "STRIPE_SPIKE_MARKER_42"; return MARKER` | 无 dynamic import，纯字面量 — 看常量是否能跨模块传 |
| `GET /api/spike-stripe` | `if (!IS_SAAS) return ...; const Stripe = await import('stripe'); return ...` | 看 dynamic import 是否在死分支被消除 |
| `GET /api/spike-stripe-direct` | `if (__DEPLOYMENT_MODE__ !== 'saas') return ...; const Stripe = await import('stripe'); return ...` | 看直接 macro 引用能否实现完全消除 |

---

## 3. 实验结果

### 3.1 路由 1：`/api/spike`（字面量传播）

**On-prem build 产物**（`.open-next/server-functions/default/.next/server/app/api/spike/route.js`）：

```js
async function v(){return new Response("on-prem",{status:200})}
```

**SaaS build 产物**（同路径）：

```js
function v(){return new Response("STRIPE_SPIKE_MARKER_42",{status:200}
```

✅ **完美 DCE**。`STRIPE_SPIKE_MARKER_42` 在 on-prem bundle 中 grep 0 次匹配；`"on-prem"` 在 SaaS bundle 中 grep 0 次匹配。常量经 `IS_SAAS` 导入也能 inline。

### 3.2 路由 2：`/api/spike-stripe`（IS_SAAS 函数包装 + dynamic import）

**On-prem build 产物**：

```js
async function w(){
  if(!u.c) return new Response("stripe-unavailable",{status:404});
  let {default:a} = await c.e(7097).then(c.t.bind(c,77097,23));
  return new Response(`stripe-ok-${typeof a}`,{status:200});
}
```

`u.c` 是被 webpack 引用的 `IS_SAAS`。在**首次实验（无 `alias.stripe = false`）**时：
- `.open-next/server-functions/default/.next/server/chunks/8133.js`（128KB）包含完整 Stripe SDK：`StripeAPIError`、`Account`、`Balance`、`BalanceTransactions` 等
- 即使 `IS_SAAS = false` 是死分支，Webpack 仍把 `await import('stripe')` 当 side-effectful，生成 async chunk

⚠️ **不完美**。**这正是 codex C2 警告的情景**。

**加 `webpack.resolve.alias.stripe = false`（on-prem only）后**：
- `StripeAPIError` / `StripeResource` 在整个 `.open-next/` 中 grep 0 次匹配
- 128KB Stripe chunk 完全消失
- 路由 body 仍含两个分支字面量（`"stripe-unavailable"` 和 `` `stripe-ok-${typeof a}` ``）—— 但 runtime 永远走不到第二个分支
- 第二个分支的 `c.e(7097)` 现在指向一个被 alias 抹掉的 chunk —— 如果意外走到，会 throw（fail-closed）

✅ **可接受**：核心 SDK 被排除；死代码遗留但无害（永不执行）。

### 3.3 路由 3：`/api/spike-stripe-direct`（直接 macro）

**On-prem build 产物**：

```js
async function v(){return new Response("direct-on-prem",{status:404})}
```

✅ **完美 DCE**。死分支 + `await import('stripe')` 表达式**完全消失**。terser 看到 `if (literal !== 'saas')` 直接折叠 + DCE。

---

## 4. 关键结论

### ✅ 通过项

1. **DefinePlugin 能传到 OpenNext worker** —— `__DEPLOYMENT_MODE__` 在 `next.config.ts` 的 `webpack: (config, {webpack}) => ...` 回调里注入，最终出现在 `.open-next/server-functions/default/handler.mjs`（OpenNext bundle 不重新打包 server chunks，只重新链接成一个 worker 入口）
2. **字面量传播完美**：常量 `IS_SAAS` 通过 import 链跨模块仍能正确 inline 为 `true`/`false`，纯字面量分支被 terser 消除（路由 1 验证）
3. **`webpack.resolve.alias.X = false`** 能在 on-prem build 中**完全排除** SaaS-only 的 npm 包（128KB Stripe SDK 验证消失）
4. **私有目录陷阱已识别**：所有 spike/route 必须用非 `_` 前缀

### ⚠️ 不完美项

1. **`await import('stripe')` 在死分支不会被消除**（codex C2 验证成立）—— Webpack 把 dynamic import 当 side-effectful，即使外层 `if (false)` 也保留 chunk 引用
2. **解决方案**：用 `webpack.resolve.alias.stripe = false` 让 chunk 内容为空。死代码 + 空 chunk 共存，runtime 走到会 throw（这是想要的 fail-closed 行为）
3. **常量 vs 直接 macro 的折叠差异**：
   - 常量经 import：runtime 守门 OK，dynamic import 表达式残留
   - 直接 macro：完美 DCE
   - **决策**：对**敏感 gate**（拉重 SDK 的入口）建议用直接 `__DEPLOYMENT_MODE__` macro；对**普通 gate**（仅返回 404）继续用 `CAN_BILLING` 常量。helper module 暴露两套 API。

### ❌ 失败项

无。两种核心机制都成立。

---

## 5. 决策门：**通过 → 进入 PR-1b**

但需对 v2 计划的 helper API 设计做**两点修订**：

### 修订 1：hot-gate 必须用 ambient declaration，不是 import（codex C1 修订）

> **重要**：早先想法是 export 一个 `MODE_MACRO` 让 hot-gate site 用 — **这仍然是 import 间接性，DCE 不会比 `IS_SAAS` 更彻底**。spike route 3 验证的"完美 DCE"用的是**同文件内直接引用 `__DEPLOYMENT_MODE__`**，不是 import。

**正确做法**：每个 hot-gate 文件用 `declare const` 重新引入 ambient macro：

```ts
// src/lib/deployment-mode.ts — 仅暴露常量给普通 gate / UI
declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';

export const IS_SAAS = __DEPLOYMENT_MODE__ === 'saas';
export const IS_ONPREM = __DEPLOYMENT_MODE__ === 'on-prem';
export const CAN_BILLING = IS_SAAS;
// ... 等等
// （不 export MODE_MACRO — import 间接性 ≠ DCE）
```

**hot-gate 文件**（如 `src/lib/stripe.ts`、`src/app/api/teams/invitations/accept/route.ts`）必须自己再写 `declare const`：

```ts
// src/lib/stripe.ts
/* @deployment-mode-hot-gate reason: dynamic import of stripe SDK; needs direct macro for DCE */
declare const __DEPLOYMENT_MODE__: 'saas' | 'on-prem';

export async function getStripe() {
  if (__DEPLOYMENT_MODE__ !== 'saas') {
    throw new Error('Stripe unavailable in on-prem build');
  }
  const { default: Stripe } = await import('stripe');
  return new Stripe(process.env.STRIPE_SECRET_KEY!, { apiVersion: '2024-06-20' });
}
```

ESLint 规则：

- `__DEPLOYMENT_MODE__` 仅在 `src/lib/deployment-mode.ts` + 文件顶部含 `@deployment-mode-hot-gate reason: ...` 注释的文件中允许引用
- 其它地方禁止；用 `IS_SAAS` / `CAN_*` 替代
- 注释必须含 `reason:` 段落（强审计）

### 修订 2：明确 alias 列表（v2 计划写了，再次确认）

```ts
// next.config.ts
if (DEPLOYMENT_MODE === 'on-prem') {
  config.resolve.alias = {
    ...(config.resolve.alias || {}),
    stripe: false,
    'mixpanel-browser': false,
    resend: false,
  };
}
```

这是**双保险层**：即使消费者忘了用 macro 直接 gate，alias 也保证 npm 包不会进 bundle。

---

## 6. 实测数字

| 指标 | SaaS build | On-prem build (无 alias) | On-prem build (有 alias) |
|---|---|---|---|
| `.open-next/server-functions/default/handler.mjs` | 11 MB | 11 MB | 11 MB |
| `StripeAPIError` grep 命中 | 1+ chunk | 1+ chunk（128KB 8133.js） | **0** |
| `STRIPE_SPIKE_MARKER_42` grep 命中 | 1 | 0 | 0 |
| 总构建时间（增量） | ~35s | ~35s | ~35s |

> handler.mjs 大小不变是因为本仓库已有的 Stripe webhooks 仍在 top-level import — 那部分要等 PR-4 改 `src/lib/stripe.ts` 为动态 import 后才能测出实际瘦身。本 spike 只证明机制，未实测最终瘦身收益。

---

## 7. spike 分支清理动作

spike 分支保留以下文件作为 PR-1b 的 reference：

- `src/lib/_spike-deployment-mode.ts` — 不合入；helper 正式版用 `src/lib/deployment-mode.ts`
- `src/app/api/spike/route.ts` — 不合入
- `src/app/api/spike-stripe/route.ts` — 不合入
- `src/app/api/spike-stripe-direct/route.ts` — 不合入
- `next.config.ts` 的 DefinePlugin + alias — **作为模板**复制到 PR-1b 的正式实现

`spike/deployment-mode-tree-shake` 分支用完即弃：PR-1b 在 main 上重新干净实现。

---

## 8. 对 v2 计划的更新建议

**对应 v2 计划 §2.1**（分层架构）— **不**新增 `MODE_MACRO` export（import 间接性 ≠ DCE）；helper module 仅暴露 `IS_SAAS` / `CAN_*` 常量。

**对应 v2 计划 PR-4**（gate SaaS 路由）需明确两类 gate：

| 类型 | 用什么 | 例子 |
|---|---|---|
| 普通页面 gate | `if (!CAN_BILLING) notFound()` 用 import 的常量 | `app/[locale]/(dashboard)/billing/page.tsx` |
| 拉重 SDK 的 hot gate | 文件顶部 `declare const __DEPLOYMENT_MODE__` + `if (__DEPLOYMENT_MODE__ !== 'saas')` 直接 macro | `src/lib/stripe.ts`、`src/lib/resend.ts`、`src/lib/mixpanel.ts`、`src/app/api/teams/invitations/accept/route.ts` |

**双保险**：on-prem build 的 `webpack.resolve.alias` 中 `stripe / resend / mixpanel-browser` 都设 `false` —— 即使 hot-gate 漏标，包也进不了 bundle。

**对应 v2 计划 PR-9**（ESLint 规则）：

- 禁止散落的 `process.env.DEPLOYMENT_MODE` 与 `process.env.NEXT_PUBLIC_DEPLOYMENT_MODE`
- `__DEPLOYMENT_MODE__` 仅在 `src/lib/deployment-mode.ts` + 顶部含 `/* @deployment-mode-hot-gate reason: ... */` 的文件中允许
- 注释必须含 `reason:` 段落（强审计）

---

## 9. 下一步

1. ✅ PR-0：清单已交付（`.claude/plan/saas-only-inventory.md`）
2. ✅ PR-1a：spike 通过（本报告）
3. ⏭ **PR-1b**：删除所有 spike 文件，在 main 上落地正式 `src/lib/deployment-mode.ts`（加 `MODE_MACRO`），`next.config.ts`（DefinePlugin + alias），`src/hooks/use-deployment-mode.ts`，配合 fail-closed 启动断言
4. ⏭ PR-2 ~ PR-10：按 v2 计划顺序执行；PR-4 实施时对 `src/lib/stripe.ts` 等用 macro 直接 gate

---

## 10. 验证命令（PR-1b 之后可复用）

```bash
# SaaS build sanity
DEPLOYMENT_MODE=saas pnpm build
grep -c "STRIPE_SECRET_KEY\|new Stripe(" .open-next/server-functions/default/handler.mjs   # >0

# On-prem build cleanliness（多目标扫描 — codex M4 要求）
DEPLOYMENT_MODE=on-prem pnpm build
for target in \
  .open-next/worker.js \
  .open-next/server-functions/default/handler.mjs \
  worker.js; do
  echo "=== $target ==="
  grep -c "StripeAPIError\|StripeResource\|class Stripe" "$target"   # 0
  grep -c "STRIPE_SPIKE_MARKER" "$target"                            # 0
done
# middleware / DO 目录递归
find .open-next/middleware .open-next/dynamodb-provider -type f -name "*.js" 2>/dev/null \
  | xargs grep -l "StripeAPIError\|StripeResource" 2>/dev/null      # 应为空
```

## 11. OpenNext 生产边界 — 未在本 spike 覆盖的部分（codex M4）

本 spike 验证了 server-functions/default 路径。PR-1b 实施时，verify-on-prem-bundle 脚本必须额外覆盖：

| 目标 | 状态 | PR-1b 待办 |
|---|---|---|
| `.open-next/server-functions/default/handler.mjs` | ✅ spike 已扫 | 继续 |
| `.open-next/worker.js`（OpenNext worker 入口） | ⚠ spike 未扫 | 加入扫描列表 |
| `.open-next/middleware/**`（如启用） | ⚠ 本仓库 `open-next.config.ts:22` 配了 middleware externalization；需确认 middleware 模块也走 DefinePlugin | 加 spike 覆盖中间件路径 |
| `.open-next/dynamodb-provider/**`（Cache provider） | ⚠ 极少 SaaS 引用，但要扫 | 加入扫描列表 |
| `worker.js`（仓库根的自定义 worker，re-exports Durable Objects） | ⚠ 用户代码，需手动审计 | 检查是否引用 SaaS 模块 |
| `runtime = 'edge'` 路由 | ✅ 本仓库 grep 0 命中 | 加 ESLint 规则禁止新加 edge runtime（DefinePlugin 在 edge runtime 行为未验证） |
