# Turbopack 迁移跟踪

**当前状态**：已升级到 Next 16.2.6，但 build script 显式 `--webpack` 强制走 webpack 路径。Turbopack 还**缺两个能力**才能安全切换。

**联系 owner**：deployment-mode workstream owner（见 `.claude/plan/deployment-mode-flag-v2.md`）。

---

## 为什么不能直接用 Turbopack

我们的 on-prem bundle invariant 是：**SaaS-only npm 包（stripe / resend / mixpanel-browser）+ 它们的 secret env 字面量（STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET / RESEND_API_KEY 等）必须 0 leak**。当前用 webpack 实现，靠两件事配合：

1. **DefinePlugin** —— 把 `__DEPLOYMENT_MODE__` 折叠成字面量 `'on-prem'` / `'saas'`，让 terser 看到 `if (false) {...}` 并消除整个 dead branch（包括 branch 内的 env 引用）
2. **`resolve.alias = { stripe: false, ... }`** —— 物理切断 SaaS-only 包的模块解析，作为 belt-and-suspenders

Turbopack 当前的 `turbopack` config 只有 `root` / `rules` / `resolveAlias` / `resolveExtensions` / `debugIds`，**两个都没等价物**（参考 https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack）。

**实测**（commit `d51d9a9` 调研期）：把 webpack 关掉、纯 Turbopack 跑 on-prem build → `verify:on-prem-bundle` 报 **498 个 leak**，包括 `STRIPE_WEBHOOK_SECRET` / `RESEND_API_KEY` 字面量与整个 Stripe SDK chunk。

---

## 需要等的两个 Vercel 上游

### Issue 1 — DefinePlugin 等价物

- **Upstream PR**：[vercel/next.js#90300 — Turbopack: cross-module constants](https://github.com/vercel/next.js/pull/90300)
- **关联 issue**：[#92082 — Dynamic imports not shaken from static export when constant condition is imported from another file](https://github.com/vercel/next.js/issues/92082)
- **状态**：open（2026-02-21 起），未 merge
- **作者描述的能力**：当 import 名是 `UPPER_CASE`（如我们的 `IS_SAAS`、`CAN_BILLING`）或显式 `with { turbopackConstants: 'true' }`，Turbopack 把它当 compile-time 常量参与 DCE
- **匹配度**：✅ 完全匹配。我们的 `import { IS_SAAS } from '@/lib/deployment-mode'` 一旦此 PR 合入 + 我们的 build 命中此能力，`if (!IS_SAAS) return 404` 这行会被折叠成 `return 404`，dead branch 消失

### Issue 2 — `resolveAlias` 支持 `false`

- **Upstream PR**：[vercel/next.js#93331 — feat(turbopack): support `false` values for `resolveAlias` config](https://github.com/vercel/next.js/pull/93331)
- **状态**：open（2026-04 起），未 merge
- **作者描述的能力**：`resolveAlias: { 'some-server-only-module': false }` 解析为空 stub，与 webpack 长期行为一致
- **匹配度**：✅ 直接 1:1 替换 `next.config.ts` 里的 `resolve.alias = { stripe: false, resend: false, 'mixpanel-browser': false }`

> **优先级**：Issue 1 比 Issue 2 更关键。即便没有 Issue 2，只要 Issue 1 落地，配合现有的 `await import()` wrapper + ESLint 守卫 `no-static-saas-only-import`，SDK 代码本身不会进 bundle。Issue 2 只是把"如果有人写错了 ESLint 漏掉"的兜底防线补上。

---

## 切换条件（清单）

满足以下**全部**条件才考虑移除 `--webpack`：

- [ ] Vercel PR #90300 merged & released in stable Next
- [ ] 升级到含该 release 的 Next 版本
- [ ] 跑一次 on-prem 完整 build（`DEPLOYMENT_MODE=on-prem pnpm build`，移除 `--webpack`）
- [ ] `pnpm verify:on-prem-bundle` 返回 0 leak
- [ ] `pnpm test:run` 全部通过
- [ ] （可选但推荐）PR #93331 也 merged，让 next.config.ts 的 `webpack` hook 能完整换成 `turbopack.resolveAlias`，整段 webpack 配置删除

满足条件后的一行切换：
```diff
- "build": "next build --webpack && npx opennextjs-cloudflare build --skipNextBuild",
+ "build": "next build && npx opennextjs-cloudflare build --skipNextBuild",
```

（同步删除 dev / build:next / deploy 三处的 `--webpack`。）

---

## 自动追踪

CI 不阻塞，但可以人工/定期跑：

```bash
scripts/check-turbopack-readiness.sh
```

脚本查上述两个 PR 的状态，如果都 merged 就提示"可以启动切换流程"。**当前预期输出**：两个都 open。

---

## ETA 估算（外部因素）

- Vercel 大版本节奏约半年一次；Next 16 是 2026-04 发布
- Next 17 可能落在 2026-Q4 ~ 2027-Q1
- 上述两个 PR 都对其他大客户有价值（不止我们），所以**进度 vs Vercel 路线图**而非积压
- 建议每个月跑一次 readiness 检查；如果半年内未推进，考虑在 next.js issue 留言加压（带具体 case），但不主动 fork/patch（维护成本不划算）

## 临时绕过 / 不要做的事

- ❌ **不要**把 `stripe` / `resend` / `mixpanel-browser` 重新写成静态 import（哪怕图临时省事）—— ESLint `no-static-saas-only-import` 会挡，且首要 invariant 是 bundle clean
- ❌ **不要**自己手撸 babel/swc plugin 实现 define —— Turbopack 用 SWC，Next 不暴露自定义 SWC plugin 配置入口，会陷入维护泥潭
- ❌ **不要**为了享受 Turbopack 速度删 webpack hook 接受 leak —— on-prem 客户合规审计会发现 secret 字面量

## 期间能做的事

- **dev 模式**用 Turbopack：dev bundle 不参与 on-prem distribution，可以 `pnpm dev --turbopack` 单独跑取 Turbopack 速度。但当前 `pnpm dev` script 是 `--webpack` 强制 webpack 一致性（避免开发期 hot-gate 行为漂移）。如个人想试速度，CLI 直接 `pnpm exec next dev`（默认 Turbopack）即可
- 持续维护 `eslint-rules/no-static-saas-only-import.js` 的 allowlist：新加 SaaS-only 包时同步加进 `SAAS_ONLY_PACKAGES` 集合
