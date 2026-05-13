# Registration risk-tier 风控设计

> 配合 `lib/user-lifecycle.ts`（软删 + 30 天 grace + 同身份复活）。
> 实现见 `lib/risk-tier.ts`、`db/adapter.ts` createUser、`auth.ts` createUser event、
> `lib/ai-quota.ts`、`app/api/stripe/checkout/route.ts`。

## 问题

软删 + 30 天 grace 保护了正当用户的"反悔"窗口，但留了一个滥用面：

> 注册 → 用满 trial / AI 免费配额 → 自删 → 等 30 天 hard-purge → 同邮箱再注册 → 又一份 trial。

`priorPurgeCount`（adapter.createUser 时从 audit log 查"该归一邮箱历史 hard-purge 次数"）是个直接信号。但**单一信号 + 阈值拒绝**有三个问题：

- 误伤合规用户（真正改主意的人也可能重注一次）
- 不可解释（被拒的人不知道为什么）
- 法律风险（仅凭"曾经删除"拒绝服务在某些司法区可能不合规）

## 设计

把 `priorPurgeCount` 当成一个**评分信号**，与其他信号叠加产出 `riskTier`（0..4），下游决策点都读 tier 分流。**不拒绝注册**，而是**限制每个 tier 能造成的损害**。

### 信号

| 信号 | 来源 | 含义 |
|------|------|------|
| `priorPurgeCount` | `audit_logs.metadata.emailNormalizedHistorical` 计数 | 同邮箱历史 hard-purge 次数 |
| `signupIpHash 24h cluster` | 同 hash + 24h 内的 user count | 同 IP 短时间多账号注册 |
| `signupIpHash` 一次性邮箱 | `email-disposable.ts` | 一次性邮箱供应商 |
| (未来) device fingerprint | TBD | 浏览器指纹聚类 |
| (未来) email age | hibp / email-verification.org | 邮箱注册时长 |

### 评分公式

```text
fromPurge = clamp(priorPurgeCount, 0, 4)    // 1→1, 2→2, 3→3, ≥4→4
fromIp    = ipCluster ≥ 4 ? 2
          : ipCluster = 3 ? 1
          : 0
tier      = max(fromPurge, fromIp)
```

阶梯刻意**逐级递增**而非线性叠加：单点 priorPurge=4 直接到顶（清晰可解释），多个低强度信号不会偶然飙到高 tier（避免误伤）。

### Tier → Policy 表

| Tier | trial 天数 | AI 配额乘子 | API 配额乘子 | Stripe checkout | 强制 email verify | 注册告警 |
|------|-----------|-------------|--------------|-----------------|-------------------|---------|
| 0 trusted  | 14 | 1.0  | 1.0  | ✅ | ❌ | ❌ |
| 1 normal   | 7  | 0.5  | 1.0  | ✅ | ❌ | ❌ |
| 2 elevated | 0  | 0.25 | 0.5  | ✅ | ✅ | ✅ |
| 3 high     | 0  | 0    | 0.25 | ❌ | ✅ | ✅ |
| 4 hard     | 0  | 0    | 0    | ❌ | ✅ | ✅ |

实现在 `policyForTier(tier)`；下游模块（`checkAiQuota`、`stripe/checkout`、auth `createUser` event）**全部读这一个表**，避免散落 if 链。

### 决策点

| 决策点 | 文件 | 读取 |
|--------|------|------|
| 给 trial 天数 | `auth.ts` events.createUser | `policy.trialDays`（与 env `TRIAL_DAYS` 取较小值 = 风控护栏 ≤ 产品配置） |
| 是否允许 AI 调用 | `lib/ai-quota.ts` checkAiQuota | `policy.aiQuotaMultiplier`、`policy.requireEmailVerifiedForApi` |
| 是否允许自助升级 Stripe | `app/api/stripe/checkout/route.ts` | `policy.allowStripeCheckout` |
| 注册时通知运维 | `db/adapter.ts` createUser | `policy.alertOnRegistration` → POST Slack webhook |
| (未来) API key 创建 | TODO | `policy.apiQuotaMultiplier` 应该决定能创几把 key |

### 不做的事

- ❌ 不在 signIn / createUser 路径里**拒绝**用户
- ❌ 不把 priorPurgeCount 暴露到前端（信号脱敏）
- ❌ 不阻塞 cron 路径或 admin 工具（运维永远能介入）

### 申诉路径

1. 用户收到 quota 错误 → 提示包含 `tier ${tier} 影响配额`
2. 用户 email support@aster-lang.cloud
3. Admin tool（TODO）查 `User.riskTier` + `riskTierReason` → 决定是否手动降级
4. 手动 `UPDATE "User" SET "riskTier"=0, "riskTierReason"='manual_override:<ticket-id>' WHERE id=$1`
5. 写 audit log `user.risk_tier_overridden` 供后续审计

### 数据保留 / GDPR

- `User.riskTier` 和 `riskTierReason` 在用户行存在期间保留
- hard-purge 时一并删除（不留 PII）
- audit log `user.hard_purged.metadata.emailNormalizedHistorical` 保留**归一邮箱**而非原邮箱（如 `foo+x@gmail.com` → `foo@gmail.com`），介于"完全删除"与"完全保留"之间的妥协

### 监控

- Slack `SLACK_RISK_WEBHOOK` 收到每次 tier ≥ 2 注册（fire-and-forget，不阻塞 signup）
- Grafana 面板（TODO）：tier 分布柱图 + tier ≥ 2 注册速率告警

### 后续工作

1. Admin tool UI：列 `riskTier > 0` 用户 + 手动降级按钮
2. 自动复评 cron：tier ≥ 2 用户 7 天无异常行为 → 自动降到 tier 1
3. 信号扩展：emailAge、deviceFingerprint
4. 信号回写：当用户被 `aiBannedUntil`、Stripe 拒付时把 tier 临时调高
