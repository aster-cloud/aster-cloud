# 实施计划：License System v2（签名 + 撤销）

> 工作区：`/Users/rpang/IdeaProjects/aster-cloud`（on-prem 端 + SaaS revocation endpoint）+ `/Users/rpang/IdeaProjects/aster-deploy`（私有签发工具）
> 日期：2026-05-18
> 状态：规划阶段，未实施
> 基础：PR-8 已上线 v1（unsigned base64 license + UI + 全测试覆盖）
> 设计依据：codex MCP 双模型分析（session `019e39e9-...` + `019e39ea-...`）；Adobe grace period 模型 + Sentry/GitLab EE revocation list 行业实践
>
> **核心立场**：不强制 phone-home（保留 on-prem 自治 USP）；签名 license + 离线友好 revocation list + 软降级 grace period

---

## 0. 任务类型

- [x] 全栈 — 跨 3 个 repo：aster-cloud（on-prem 客户端 + SaaS 端 revocation endpoint）、aster-deploy（私有签发工具）、可能涉及 Vault/HSM 集成

---

## 1. 目标与验收标准

### 目标

升级 PR-8 的 v1 license 系统到生产级，支持：

| 能力 | v1 (PR-8) | v2 (本计划) |
|---|---|---|
| Payload 解析 | ✅ base64 unsigned | ✅ 同 + 签名校验 |
| 防伪 | ❌ 任何人可以编辑 payload | ✅ Ed25519 签名，公钥嵌入 build |
| 撤销 | ❌ 只能等过期 | ✅ Aster 端公开签名 revocation list + 24h 拉取 + 7 天 grace |
| 两档 SKU | ❌ 单一 | ✅ standard（订阅 + revocation）vs air-gapped（perpetual/5y，跳过 revocation） |
| Feature gating 可信度 | ❌ `verification: 'unsigned'` 不可用于授权 | ✅ `verification: 'verified'` 可作为授权依据 |
| 密钥轮换 | ❌ N/A | ✅ 支持多 active public key，从 build 内嵌 |

### 验收标准

1. **签名校验**：任何被 Aster 私钥签发的 license key 都能在 on-prem 启动时通过 Ed25519 校验；公钥指纹与嵌入的 trust bundle 不一致 → status `signature-untrusted-key`
2. **Revocation 触达**：Aster 端 ops 在 `/admin/license-revoke`（SaaS）操作后，正常网络的 on-prem 客户在下一次 24h cron 内（或手动 "Refresh now"）看到 `verified-revoked` 状态
3. **离线韧性**：Standard SKU 在 revocation endpoint 不可达时，**7 天内**继续按 `network-grace` 正常运行；超过 7 天进 `network-grace-expired`（产品决策 = 软降级到 read-only，admin 操作禁用）
4. **Air-gapped 行为**：`sku: 'air-gapped'` 字段在 signed payload 中 → 客户端完全跳过 revocation 网络调用 + UI 显示 `revocationMode: 'disabled-by-sku'` 而不是 grace
5. **密钥 ceremony**：签发工具不持有原始私钥（KMS/Vault 后端签名服务）；2 人审批 + 不可变 audit log
6. **回归不变**：PR-8 v1 测试全部保留（向后兼容窗口期内 v1 key 仍被识别，但状态降级为 `legacy-unsigned`）
7. **UI 状态精确**：admin/license 页 v2 展示精确状态（11 种），单一主 banner + 次要 advisories，符合 codex UI 分析建议
8. **i18n 完整**：en/zh/de 三语完整 + ICU plural 处理 days/hours
9. **测试覆盖**：license.ts parser + verifier、revocation cache state machine、cron handler、API endpoint、admin UI 4 个 panel 变体 ≥ 95% branch coverage
10. **CI gate**：on-prem build 中 `LICENSE_PRIVATE_KEY` 字面量 0 出现（PR-7 verify scripts 加新规则）

---

## 2. 技术方案

### 2.1 整体架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                       Aster 内部（aster-deploy 私有 repo）              │
│                                                                          │
│  scripts/issue-license.ts                                                │
│       │                                                                  │
│       ▼                                                                  │
│  KMS/Vault 签名服务（私钥不出 vault）                                    │
│       │                                                                  │
│       └──→ aster-ent-v2-<keyId>-<base64url(payload)>.<sig>               │
│                          │                                               │
│                          │ 销售/法务通过加密渠道发给客户                  │
│                          ▼                                               │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     客户 On-Prem 部署（aster-cloud, DEPLOYMENT_MODE=on-prem）│
│                                                                          │
│  process.env.LICENSE_KEY                                                 │
│       │                                                                  │
│       ▼                                                                  │
│  src/lib/license.ts                                                      │
│   ├─ parseLicenseKey()  — 拆 payload + 签名                             │
│   ├─ verifyLicense()    — Ed25519 校验（用嵌入的 publicKeys）          │
│   └─ deriveStatus()     — trust × entitlement × connectivity → 主状态  │
│       │                                                                  │
│       ▼                                                                  │
│  src/lib/license-revocation.ts                                          │
│   ├─ fetchRevocationList()  — 24h cron / 手动触发                       │
│   ├─ cacheToPostgres()       — 持久化（license_cache 表）              │
│   └─ enforceGracePeriod()    — 7 天滑动窗口                            │
│       │                                                                  │
│       ▼                                                                  │
│  Postgres: license_cache 表                                              │
│       │                                                                  │
│       ▼                                                                  │
│  /admin/license（UI v2）+ /api/admin/license（API v2）                  │
└─────────────────────────────────────────────────────────────────────────┘
                                  ▲
                                  │ HTTPS GET（24h cron + 手动）
                                  │
┌─────────────────────────────────────────────────────────────────────────┐
│                  Aster SaaS（aster-cloud, DEPLOYMENT_MODE=saas）         │
│                                                                          │
│  GET https://license.aster-lang.cloud/revoked.json                       │
│  （Workers route, 公开，CDN cached, ETag）                              │
│       │                                                                  │
│       ▼                                                                  │
│  src/app/api/license/revoked/route.ts                                    │
│   └─ 从 Postgres 读 revoked_licenses 表 → 签名 → JSON                  │
│                                                                          │
│  /admin/license-revoke（SaaS 端 admin UI，标记 license 撤销）          │
│  POST /api/admin/license-revoke                                          │
│   └─ 写入 revoked_licenses 表 + 触发 publish job                       │
└─────────────────────────────────────────────────────────────────────────┘
```

### 2.2 三大数据契约

#### License key v2 格式

```
aster-ent-v2-<keyId>-<base64url(canonical-payload)>.<base64url(signature)>
```

`canonical-payload` JSON（按 key 字母序序列化，无空格）：
```ts
{
  schemaVersion: 2,
  licenseId: 'lic_01J5N7K8Z3Q9...',  // UUID v7 / random 22 chars opaque
  keyId: 'lic-2026-01',                // 用哪个签名 key（rotation 用）
  customer: 'Acme Corp',
  issuedAt: '2026-05-18T00:00:00.000Z',
  expiresAt: '2027-05-18T00:00:00.000Z',
  notBefore: '2026-05-18T00:00:00.000Z', // 可选；防止预签发 key 立即生效
  seatLimit: 500,                       // -1 = unlimited
  tier: 'enterprise' | 'enterprise-plus',
  features: ['sso', 'audit-export'],
  sku: 'standard' | 'air-gapped',
  licenseTerm: 'annual' | 'five-year' | 'perpetual',
  deploymentBinding: null,              // 可选；future use（域名/指纹）
  revocationCheckUrl: 'https://license.aster-lang.cloud/revoked.json',
  // standard SKU 必填，air-gapped 可空
}
```

`signature` = Ed25519 over `canonical-payload` 的 UTF-8 字节。

#### Revocation list 格式

```ts
{
  schemaVersion: 1,
  version: 1234,                        // 严格单调递增；client 拒绝倒退
  publishedAt: '2026-08-01T12:00:00.000Z',
  validUntil: '2026-08-08T12:00:00.000Z',  // publishedAt + 7d
  revoked: [
    {
      licenseId: 'lic_01J5N7K8Z3Q9...',
      revokedAt: '2026-07-15T00:00:00.000Z',
      reason: 'non-payment' | 'security' | 'renewal-superseded' | 'contract-terminated' | 'fraud',
    },
    // ... (opaque IDs only, no customer info)
  ],
  signature: '<base64url(Ed25519 sig over canonical-doc-minus-signature)>',
}
```

签名用**独立的 revocation key**（与 license signing key 分开）— 避免 ops/publish 基础设施被攻破时同时获得签发能力。

#### Postgres `license_cache` schema

```sql
CREATE TABLE license_cache (
  -- 单行表（or upsert by sentinel id='current'）—— 每个 on-prem 部署
  -- 只追踪 *自己* 的 license，不存别人的
  id TEXT PRIMARY KEY DEFAULT 'current',

  -- License 解析结果
  license_id TEXT NOT NULL,
  license_key_hash TEXT NOT NULL,        -- SHA-256(LICENSE_KEY) 用来 detect env 改动
  payload_json JSONB NOT NULL,            -- 解析后的 payload（去签名）
  signing_key_id TEXT NOT NULL,           -- 用哪个 publicKey 验签通过
  verified_at TIMESTAMPTZ NOT NULL,       -- 上次签名校验时间

  -- Revocation 状态
  revocation_version BIGINT,              -- 上次成功拉取的 list version
  revocation_published_at TIMESTAMPTZ,
  revocation_fetched_at TIMESTAMPTZ,      -- 上次 *拉取尝试* 时间
  last_successful_revocation_check_at TIMESTAMPTZ,
  last_revocation_error JSONB,            -- { url, httpStatus?, parseError?, signatureError? }

  -- 撤销结果
  is_revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,

  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE revoked_licenses (
  -- SaaS 端表 —— 仅在 DEPLOYMENT_MODE=saas 启用（PR-4 已建立的模式过滤）
  license_id TEXT PRIMARY KEY,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by TEXT NOT NULL,               -- Aster admin user id
  reason TEXT NOT NULL,
  notes TEXT,
  customer_ref TEXT,                       -- internal-only customer reference
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE revocation_publications (
  version BIGINT PRIMARY KEY,             -- 单调递增
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_until TIMESTAMPTZ NOT NULL,
  revoked_count INT NOT NULL,
  signed_doc TEXT NOT NULL,                -- 完整签名 JSON（缓存避免每次重签）
  signature TEXT NOT NULL
);
```

### 2.3 状态机（codex UI 分析结论）

**不要**把 11 个 UI 状态硬编码成单一 enum。内部拆 3 个维度，UI 层 derive 单一显示状态：

```ts
trustStatus:        'missing' | 'malformed' | 'legacy-unsigned' | 'signature-invalid'
                  | 'signature-untrusted-key' | 'verified'

entitlementStatus:  'active' | 'expiring-soon' | 'expired' | 'revoked'

connectivityStatus: 'not-applicable' | 'fresh' | 'grace' | 'grace-expired' | 'error'
```

**UI 主状态显示精度（11 种）**，按精度从高到低：

| Display Status | 触发 | 主 banner severity |
|---|---|---|
| `missing` | trust=missing | danger（block） |
| `malformed` | trust=malformed | danger |
| `legacy-unsigned` | trust=legacy-unsigned（v1 key 在兼容窗口期内） | warning |
| `signature-invalid` | trust=signature-invalid | danger |
| `signature-untrusted-key` | trust=signature-untrusted-key | danger |
| `verified-revoked` | trust=verified + entitlement=revoked | danger |
| `verified-expired` | trust=verified + entitlement=expired | danger |
| `network-grace-expired` | trust=verified + connectivity=grace-expired | warning（强） |
| `verified-expiring-soon` | trust=verified + entitlement=expiring-soon | warning |
| `network-grace` | trust=verified + connectivity=grace + entitlement!=expiring-soon | info（次要） |
| `verified-active` | trust=verified + entitlement=active + connectivity ∈ {fresh, not-applicable} | success |

**关键 UI 准则**：
- **单一主 banner**：永远只显示一个 primary status，避免叠加导致 operator 不知道哪个最紧急
- **次要 advisories**：作为副内联文本，不再用 banner 形式（e.g. expiring-soon + network-grace 同时出现 → primary 是 expiring-soon，secondary 是 "Revocation status stale, last check N min ago"）
- **Air-gapped 显示**：connectivity = `not-applicable`，UI 显示 `"Revocation disabled by air-gapped SKU"` 中性 policy note，**不**显示 grace 警告

### 2.4 关键决策（codex 分析结论 + 我的选择）

| 决策点 | 选择 | 理由 |
|---|---|---|
| Revocation endpoint 形态 | **公开 signed JSON 文件**（不是 query API） | CDN 友好；客户端简单；license ID opaque 不泄漏 PII |
| License signing 与 revocation signing key | **分开 2 个 Ed25519 keypair** | publish 基础设施被攻破不能签发新 license |
| 私钥存储 | **Vault 后端 signing 服务**（或 AWS KMS） | 私钥不出 vault；签发工具调 API |
| 签发审批 | **2 人审批**（sales/legal request + security/ops approve） | 防内部滥用 |
| 公钥分发 | **嵌入 on-prem build**（hardcoded array, 支持 multiple active keys） | 完全离线可验；rotation 通过新 build 上线 |
| 客户端 cache 后端 | **Postgres**（不是 KV / 内存） | 已是 stack 内现成的；durable across worker restarts；admin UI 可查 |
| Cron vs lazy fetch | **两者都用** | cron 定期；首请求触发 lazy 兜底；admin UI "Refresh now" 手动 |
| Grace period 长度 | **7 天**（Adobe 同款） | 容忍正常网络故障；短于客户 IT 反应时间 |
| grace-expired 行为 | **软降级到 read-only**（admin 操作禁用，用户只读） | 不硬锁登录（避免客户灾难性体验）；但限制写操作 |
| Air-gapped SKU 区分 | **payload `sku` 字段**（被签名保护） | 同一 binary 验证两种 SKU；客户不能自己改 |
| v1 → v2 迁移 | **30 天 v1 兼容窗口**，UI 显示 `legacy-unsigned` 警告 | 给现有客户重发 v2 key 的时间 |
| 时钟保护 | `max_seen_time` 单调推进 + revocation list `publishedAt` 作弱时间锚 | 不能完全防本地时钟回拨；硬保护需要 TPM |
| Deployment binding | v2 **不做**（payload 留 `deploymentBinding: null` 字段，future use） | 太多 DR / migration 摩擦；先靠合同约束 |
| 失败 fetch 行为 | fail-open + grace 计时器；HTTP 304 算成功（更新 last_successful_check_at） | 不让客户因为 SaaS endpoint 短暂故障被锁服务 |

### 2.5 反向不变量

| 不变量 | 守护 |
|---|---|
| 私钥永不离开 Vault/KMS | 签发工具只调 API，不下载 key；CI 扫描 `LICENSE_PRIVATE_KEY` 字面量 |
| 公钥可轮换无中断 | trust bundle 支持 multi-active key；旧 key 进 `verify-only` status 直到所有 license 过期 |
| Revocation list 不可篡改 | 客户端校验签名 + 拒绝旧 version |
| Air-gapped 客户不被网络故障误锁 | sku=air-gapped → connectivity=not-applicable 路径完全跳过 fetch |
| v2 license 可信但 v1 不可用于授权 | `hasLicenseFeature()` 只 trust `verification='verified'`；`legacy-unsigned` 返回 false |
| Revocation 状态本地不被构造 | 只持久化签名验证通过的 revocation list；新拉取 version 必须 >= 缓存 |
| UI 不显示具体 customer 信息 | revocation list 只含 opaque licenseId + reason |

---

## 3. 实施步骤（按 PR 顺序）

> 12 个 PR，跨 3 个 repo。每个 PR 单独 reviewable + 独立 deploy。

### PR-L0：密钥 ceremony + KMS 集成（aster-deploy）

**目标**：生成 production Ed25519 keypair 并存 Vault；建立 signing 服务（不暴露私钥）。

**产物**：
- `aster-deploy/docs/license-key-ceremony.md` — 密钥生成 SOP（2 人在场，气隙环境）
- Vault path：`secret/license/signing/v2-2026-01` 和 `secret/license/revocation/v2-2026-01`
- `aster-deploy/services/license-signing-api/`（可选 — 简单 Node service 调 Vault transit engine 签名）

**关键决策**：
- **Vault Transit Engine** 直接签 — 私钥永不导出；transit API `POST /v1/transit/sign/<key>/sha2-512`
- 备用 keypair（backup）独立 ceremony；存 air-gapped vault；只在主 key 失陷时启用

### PR-L1：License key v2 格式 + 签发工具（aster-deploy）

**目标**：内部签发工具能生成 v2 签名 key。

**产物**：
- `aster-deploy/scripts/issue-license.ts`（CLI）
  ```bash
  pnpm tsx scripts/issue-license.ts \
    --customer "Acme Corp" \
    --tier enterprise \
    --seats 500 \
    --term annual \
    --features sso,audit-export \
    --sku standard
  ```
- 2 人审批流：CLI 先生成 payload preview → 第二人 review + 输入第二个 vault token → 签发
- 不可变 audit log（写 Aster 内部审计 DB / Slack #licenses 频道）

### PR-L2：on-prem 端公钥 trust bundle + 签名校验（aster-cloud）

**目标**：on-prem 启动时能用嵌入的公钥验证 license 签名。

**产物**：
- `src/lib/license-trust-bundle.ts`：
  ```ts
  export const ASTER_TRUST_BUNDLE = [
    { keyId: 'lic-2026-01', purpose: 'license',    pubKey: 'MCowBQYDK2VwAyEA...', status: 'active' },
    { keyId: 'rev-2026-01', purpose: 'revocation', pubKey: 'MCowBQYDK2VwAyEA...', status: 'active' },
    // 未来加新 key：先加 'active'，6 个月后旧 key 改 'verify-only'，1 年后 'retired'
  ] as const;
  ```
- `src/lib/license.ts` 升级 `parseLicenseKey` → `verifyLicenseKey`：
  - 拆 v2 格式 `aster-ent-v2-<keyId>-<payload>.<sig>`
  - 查 trust bundle 找 publicKey
  - 用 Web Crypto API `crypto.subtle.verify('Ed25519', ...)` 校验
  - 返回升级版 `LicenseResult` 含 `trustStatus` 维度
- v1 兼容：检测到 `aster-ent-<yyyy>-...`（无 v2 前缀，无 sig） → trust=`legacy-unsigned`
- 测试：所有 trust path（valid sig、wrong key id、tampered payload、bad base64、v1 fallback）

### PR-L3：Revocation list cache 表 + Postgres migration（aster-cloud）

**目标**：建立 on-prem `license_cache` 表 + SaaS `revoked_licenses` + `revocation_publications` 表。

**产物**：
- Drizzle migration `0010_license_cache.sql`（on-prem + SaaS 共享 schema）
- `src/db/schema.ts` 加 3 个表 type
- 模式过滤：表本身两边都有，但 SaaS 写 `revoked_licenses`，on-prem 写 `license_cache`

### PR-L4：on-prem revocation fetch + cache state machine（aster-cloud）

**目标**：on-prem 周期拉取 + 缓存 + grace period 状态机。

**产物**：
- `src/lib/license-revocation.ts`：
  - `fetchRevocationList(url)` — HTTP GET + ETag + signature verify
  - `evaluateGracePeriod(cache, now)` → connectivityStatus
  - `updateCache(parsed)` — Postgres upsert
- `src/app/api/cron/license-revocation-refresh/route.ts` — 24h cron handler
- `wrangler.toml` 加 `triggers.crons` 项（仅 on-prem build）
- 状态机测试：fresh → grace → grace-expired transitions；version 倒退拒绝；签名失败拒绝

### PR-L5：deriveDisplayStatus 函数 + LicenseResult shape v2（aster-cloud）

**目标**：把 3 维内部状态合成单一 display status；API 返回结构化结果。

**产物**：
- `src/lib/license.ts` 加 `deriveDisplayStatus(trust, entitlement, connectivity, sku) → DisplayStatus`
- `LicenseResult` v2 shape：
  ```ts
  {
    trustStatus,
    entitlementStatus,
    connectivityStatus,
    displayStatus,
    payload?: LicensePayload | null,
    keyPreview,
    daysRemaining?,
    secondaryAdvisories: ['expiring-soon' | 'revocation-stale' | ...],
    diagnostics: { revocationVersion?, lastCheckAt?, lastError?, ... },
  }
  ```
- 单测覆盖所有状态合成（precedence 矩阵）

### PR-L6：admin/license UI v2（aster-cloud）

**目标**：UI 渲染所有 11 种 displayStatus + secondary advisories + actions（refresh now / download support bundle）。

**产物**：
- `src/app/[locale]/(dashboard)/admin/license/license-content.tsx` 重写：
  - `LicenseStatusSummary`（top — 唯一 primary banner）
  - `StatusAdvisories`（secondary 内联，不抢眼）
  - `LicenseDetails`（<dl> 复用 PR-8）
  - `RevocationStatusPanel`（standard SKU 显示；air-gapped 隐藏 + policy note）
  - `OperatorActions`（Refresh now、Download support bundle、Contact renewal）
  - `SupportDiagnostics`（collapsible，endpoint URL / HTTP / parse error / trust bundle version）
- i18n: 完整重排（`admin.license.status.*` / `admin.license.advisory.*` / `admin.license.details.*` / `admin.license.actions.*` / `admin.license.time.*` / `admin.license.diagnostics.*`）
- ICU plural `{days, plural, one {# day remaining} other {# days remaining}}` for countdown
- a11y：单 role=status banner + role=alert 仅新错误；icon+text+severity 不靠 color；Tab 顺序合理

### PR-L7：SaaS 端 revocation endpoint（aster-cloud DEPLOYMENT_MODE=saas）

**目标**：公开签名 revocation.json + admin 端撤销操作 UI。

**产物**：
- `src/app/api/license/revoked/route.ts` — GET 返回最新签名 JSON（CDN cache + ETag）
- `src/app/api/admin/license-revoke/route.ts` — POST 标记 license 撤销（admin only）
- `src/app/[locale]/(dashboard)/admin/license-revoke/page.tsx` — Aster 内部 admin 标记撤销表单
- `src/lib/revocation-publisher.ts` — 标记撤销后触发重新签名 + 写入 `revocation_publications` 表
- CDN headers：`Cache-Control: public, max-age=3600, must-revalidate`；ETag 基于 `revocation_publications.version`
- Cloudflare cache rules：将 `/api/license/revoked` 命中 CDN cache

### PR-L8：v1 → v2 兼容性 + 迁移窗口（aster-cloud）

**目标**：v1 key 在 30 天兼容窗口内识别为 `legacy-unsigned`；UI 显示警告 + 通知客户升级。

**产物**：
- `src/lib/license.ts` 检测无 `v2-` 前缀 → 走 v1 解析路径 → trust=`legacy-unsigned`
- UI 显示橙色 banner: "Your license is unsigned (v1 format). Please contact sales for a v2 key. v1 keys will stop working on YYYY-MM-DD."
- 30 天后（环境变量 `LICENSE_V1_DEADLINE`）自动降级到 `malformed`
- `hasLicenseFeature` 在 v1 模式下永远返回 false（不能用于授权）

### PR-L9：Aster 内部撤销 workflow + audit log（aster-cloud SaaS）

**目标**：让 Aster ops/sales 团队能在 admin UI 安全标记 license 撤销，所有操作可审计。

**产物**：
- `revoked_licenses.notes` 字段必填（撤销理由）
- 撤销操作写入 `auditLogs` 表（PR-3 已建立的 admin audit log 表）
- Slack webhook 通知 #licenses-ops 频道
- "Undo" 按钮：6h 内可撤回（防误操作）

### PR-L10：on-prem cron 触发 + manual refresh（aster-cloud）

**目标**：cron 自动触发 + "Refresh now" 按钮手动触发；二者复用同一 `fetchRevocationList` 函数。

**产物**：
- `wrangler.toml` 加 `triggers.crons = ["0 */24 * * *"]`（每 24h；on-prem build only）
- 路由 `/api/admin/license/refresh`（POST）— admin 触发 immediate refresh + 返回新 cache 状态
- UI 按钮 + 状态反馈（disabled while in-flight; success/failure aria-live）

### PR-L11：测试 + verify scripts 升级 + 文档

**目标**：所有路径覆盖；PR-7 verify scripts 加新规则；客户文档。

**产物**：
- 单元测试：license-trust-bundle / license-revocation / deriveDisplayStatus 各 ≥95% branch
- 集成测试：模拟 cron 触发 + endpoint mock + cache state transitions
- E2E（vitest projects）：sample fixture license 全 11 状态截图比对（snapshot）
- PR-7 verify scripts 加扫描：on-prem build 不含 `LICENSE_PRIVATE_KEY` 字面量
- 客户文档：`docs/on-prem/license-management.md`（如何设置 LICENSE_KEY、如何处理 grace 状态、如何联系 renewal）

---

## 4. 关键文件清单

### aster-deploy（私有 repo）
| 文件 | 操作 | 说明 |
|---|---|---|
| `docs/license-key-ceremony.md` | 新建 | 密钥生成 SOP |
| `services/license-signing-api/` | 新建 | Vault Transit 签名服务（可选） |
| `scripts/issue-license.ts` | 新建 | 2 人审批签发 CLI |

### aster-cloud（本仓库）
| 文件 | 操作 | PR |
|---|---|---|
| `src/lib/license-trust-bundle.ts` | 新建 | L2 |
| `src/lib/license.ts` | 重写 | L2 + L5 + L8 |
| `src/lib/license-revocation.ts` | 新建 | L4 |
| `src/db/schema.ts` | 修改 — 3 新表 | L3 |
| `drizzle/0010_license_cache.sql` | 新建 | L3 |
| `src/app/api/cron/license-revocation-refresh/route.ts` | 新建 | L4 |
| `src/app/api/admin/license/route.ts` | 修改 | L5 |
| `src/app/api/admin/license/refresh/route.ts` | 新建 | L10 |
| `src/app/[locale]/(dashboard)/admin/license/license-content.tsx` | 重写 | L6 |
| `src/app/[locale]/(dashboard)/admin/license/components/*.tsx` | 新建 — 6 个子组件 | L6 |
| `src/app/api/license/revoked/route.ts` | 新建 — SaaS only | L7 |
| `src/app/api/admin/license-revoke/route.ts` | 新建 — SaaS only | L7 + L9 |
| `src/app/[locale]/(dashboard)/admin/license-revoke/page.tsx` | 新建 — SaaS only | L7 + L9 |
| `src/lib/revocation-publisher.ts` | 新建 — SaaS only | L7 |
| `messages/{en,zh,de}.json` | 修改 — admin.license namespace 全重组 | L6 |
| `wrangler.toml` | 修改 — cron triggers | L10 |
| `scripts/verify-on-prem-bundle.ts` | 修改 — 加 LICENSE_PRIVATE_KEY 扫描 | L11 |
| `src/__tests__/lib/license.test.ts` | 修改 — v2 测试 | L2 + L4 + L5 |
| `src/__tests__/lib/license-revocation.test.ts` | 新建 | L4 |
| `src/__tests__/lib/license-display-status.test.ts` | 新建 | L5 |
| `docs/on-prem/license-management.md` | 新建 | L11 |

---

## 5. 风险与缓解

| 风险 | 缓解措施 |
|---|---|
| 私钥泄漏 | Vault Transit Engine 私钥不出 vault；备用 keypair；rotation 流程文档化 |
| Revocation endpoint DDoS | Cloudflare edge cache + rate limit；endpoint 100% static signed JSON |
| 客户网络封 endpoint 永久 grace | 7 天 grace 后软降级（read-only），不硬锁；UI 警告突出 |
| Air-gapped 客户合同失约 | 法律合同强约束 + perpetual SKU 价格 3-5x |
| v1 → v2 迁移破坏现有客户 | 30 天兼容窗口 + 显眼 UI 警告 + 主动联系所有 v1 客户 |
| 时钟回拨绕过 expiry | max_seen_time 单调推进 + revocation publishedAt 作弱锚；硬保护需要 TPM（out of scope） |
| 公钥嵌入需新版本上线 | Trust bundle 支持 multi-active keys；6-12 个月 rotation 窗口 |
| Cron 不可靠（Cloudflare Workers 限制） | cron + lazy fetch + manual refresh 三重触发 |
| Postgres cache 损坏 | upsert by sentinel id='current'；任何错误回退到 in-memory + 标记 cache-corrupted |
| License key 在多个 deployment 共享（盗用） | v2 不做 deployment binding（payload 留字段 future-use）；初期靠合同 |
| UI 11 种状态太复杂操作员误判 | codex UI 分析：单一主 banner + secondary advisories；每状态都有明确 action |
| i18n 翻译漂移 | check:locales:strict 在 PR-9 ESLint 之外加 ICU 校验；翻译表 PR-L6 一次性建立 |
| 测试覆盖断层 | 11 种 displayStatus 每种都要 snapshot；deriveDisplayStatus 是纯函数好覆盖 |

---

## 6. 验证步骤（合并前必跑）

```bash
# === aster-deploy 端 ===
cd /Users/rpang/IdeaProjects/aster-deploy

# 验证签发工具 + 2 人审批流
pnpm tsx scripts/issue-license.ts --dry-run --customer Test --tier enterprise --seats 10 --term annual --sku standard
# 应触发 "Awaiting second approver" 状态

# === aster-cloud on-prem 端 ===
cd /Users/rpang/IdeaProjects/aster-cloud

# 0. 全量测试 + 双 mode
pnpm test:run                          # 1914+ tests, +约 200 新增

# 1. 校验 trust bundle 完整
pnpm tsx scripts/verify-trust-bundle.ts  # 验证嵌入公钥指纹与 KMS 一致

# 2. SaaS build sanity
DEPLOYMENT_MODE=saas pnpm build
curl http://localhost:8787/api/license/revoked.json | jq .  # 应返回 signed JSON

# 3. on-prem build clean
DEPLOYMENT_MODE=on-prem pnpm build
pnpm verify:on-prem-bundle              # PR-7 scanner + 新规则
# 应通过：LICENSE_PRIVATE_KEY 字面量 = 0
pnpm verify:on-prem-ui

# 4. on-prem fixture 测试（用 dev signing key 签的测试 license）
LICENSE_KEY=$(cat tests/fixtures/test-license-v2.txt) DEPLOYMENT_MODE=on-prem pnpm dev &
sleep 5
curl http://localhost:8787/api/admin/license | jq .displayStatus  # verified-active

# 5. 模拟 revocation
# 在本地起一个 mock revocation endpoint，把 fixture license id 加入 revoked
# 触发手动 refresh → 期望 verified-revoked

# 6. 模拟 network failure
# 关闭 mock endpoint，等 cron 拉取失败 → expect network-grace；
# 调时钟到 +8 天 → expect network-grace-expired

# 7. air-gapped fixture（sku=air-gapped）
LICENSE_KEY=$(cat tests/fixtures/test-license-airgap-v2.txt) DEPLOYMENT_MODE=on-prem pnpm dev &
curl http://localhost:8787/api/admin/license | jq '.connectivityStatus'  # not-applicable

# 8. v1 兼容
LICENSE_KEY=$(cat tests/fixtures/legacy-v1.txt) DEPLOYMENT_MODE=on-prem pnpm dev &
curl http://localhost:8787/api/admin/license | jq '.trustStatus'  # legacy-unsigned
```

---

## 7. PR 依赖图

```
PR-L0 (密钥 ceremony)
  ↓
PR-L1 (签发工具，需私钥可用) ─────┐
                                  │
PR-L2 (trust bundle + 验签) ←────┤  (公钥来自 L0)
  ↓                                │
PR-L3 (cache 表) ─→ PR-L4 (revocation fetch + state machine) ─→ PR-L5 (deriveDisplayStatus)
                                                                       ↓
                                                                  PR-L6 (UI v2)
                                                                       ↓
                                                                  PR-L8 (v1 兼容)
                                                                       ↓
PR-L7 (SaaS revocation endpoint) ─→ PR-L9 (SaaS 撤销 workflow + audit)
                                                                       ↓
PR-L10 (cron + manual refresh) ←─ 需要 L4+L7 都上线
                                                                       ↓
                                                                  PR-L11 (测试 + verify scripts + 文档)
```

**关键路径**：L0 → L1 → L2 → L5 → L6 → L11（最小可用闭环；revocation 部分在 L7+L4+L10 并行展开）
**估算工作量**：12 个 PR × 平均 1.5-2 天 = ~20-25 工作日（不算 SaaS 端 admin UI 完善 + 客户支持文档）

---

## 8. SESSION_ID

- **后端架构分析 SESSION_ID**：`019e39e9-39f2-7a32-b1db-6ab54db35b64`（codex MCP，可 `/ccg:execute resume`）
- **前端 UX 分析 SESSION_ID**：`019e39ea-cb57-7d10-990a-f399d70d14d5`（codex MCP）

---

## 9. 后续 / Out of scope（v3+）

- **Deployment binding**（防 license 跨 deployment 共享）— payload 已留 `deploymentBinding` 字段
- **License usage telemetry**（opt-in phone-home）— 帮 Aster 了解客户使用模式
- **Self-serve renewal portal**（客户自助续约 SaaS 后台）
- **SCIM-based seat enforcement**（实时席位限制，目前 v2 只展示限额不强制）
- **Hardware-backed clock**（TPM）防本地时钟回拨
- **License signing 集成第三方 KMS**（AWS KMS / GCP KMS / Azure Key Vault）
- **License recovery flow**（客户丢失 key，安全重发流程）
- **Multi-tenant on-prem**（一个 license 覆盖多个 tenant）
