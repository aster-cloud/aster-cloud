# On-prem License 管理指南

<!-- glossary:block id=license-management-on-prem-license-paragraph-1 -->
本文档面向 Aster on-prem 部署管理员，说明如何安装、续期、排查和审计企业 license。
<!-- /glossary:block -->

---

## 1. 概览

Aster on-prem license 用于决定：

<!-- glossary:block id=license-management-1-list-item-2 -->
- license 是否由 Aster 签发并通过 Ed25519 验签
<!-- /glossary:block -->
<!-- glossary:block id=license-management-1-list-item-3 -->
- license 是否过期、即将过期或已撤销
<!-- /glossary:block -->
<!-- glossary:block id=license-management-1-list-item-4 -->
- seat 上限、套餐档位（tier）和已启用功能（features）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-1-list-item-5 -->
- standard SKU 是否需要周期性拉取公开的 revocation list
<!-- /glossary:block -->

License **不做**以下事情：

<!-- glossary:block id=license-management-1-list-item-6 -->
- 不上传策略内容、用户数据或执行日志
<!-- /glossary:block -->
<!-- glossary:block id=license-management-1-list-item-7 -->
- 不把客户环境指纹发回 Aster
<!-- /glossary:block -->
<!-- glossary:block id=license-management-1-list-item-8 -->
- 不作为 phone-home telemetry channel
<!-- /glossary:block -->
<!-- glossary:block id=license-management-1-list-item-9 -->
- 不替代合同、采购或安全审批流程
<!-- /glossary:block -->

<!-- glossary:block id=license-management-1-paragraph-10 -->
Standard SKU 会访问公开的 revocation endpoint，只下载签名 JSON 文件。该文件只包含 opaque license id，不包含客户名称、邮箱、域名或使用量。
<!-- /glossary:block -->

---

## 2. 设置 LICENSE_KEY + ASTER_DEPLOYMENT_ID

<!-- glossary:block id=license-management-2-license-key-aster-deployment-id-paragraph-11 -->
每张签名 license 都绑定到一个具体部署（v3 起为**强制**）。客户需要配两个环境变量：
<!-- /glossary:block -->

```bash
LICENSE_KEY='aster-ent-v2-lic-2026-01-<payload>.<signature>'
ASTER_DEPLOYMENT_ID='<sha256-hex>'   # Aster 签发时一并交付，64 lowercase hex
```

<!-- glossary:block id=license-management-2-license-key-aster-deployment-id-paragraph-12 -->
`ASTER_DEPLOYMENT_ID` = `sha256(<customer>|<deployment-slug>)`。Aster 签发流程
（`scripts/license-issue.sh`）会在终端打印这串 hex；销售把 license key + 这串 id
一起加密交付给你。**如果你把同一张 license 装到不止一个集群，只有 ASTER_DEPLOYMENT_ID
匹配的那个能跑** —— 其他集群会进入 `binding-mismatch` read-only 状态。
<!-- /glossary:block -->

<!-- glossary:block id=license-management-2-license-key-aster-deployment-id-paragraph-13 -->
生产环境**不要**把 license 写进镜像。请使用 secret 管理系统注入环境变量。
<!-- /glossary:block -->

### Kubernetes Secret 示例

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: aster-license
type: Opaque
stringData:
  LICENSE_KEY: "aster-ent-v2-lic-2026-01-<payload>.<signature>"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: aster-cloud
spec:
  template:
    spec:
      containers:
        - name: aster-cloud
          image: registry.example.com/aster-cloud:on-prem
          env:
            - name: LICENSE_KEY
              valueFrom:
                secretKeyRef:
                  name: aster-license
                  key: LICENSE_KEY
            # v3 deployment binding：必须与 license 签发时给的 hash 完全一致
            # 否则 verify 进入 binding-mismatch 状态，admin 写操作被锁
            - name: ASTER_DEPLOYMENT_ID
              valueFrom:
                secretKeyRef:
                  name: aster-license
                  key: ASTER_DEPLOYMENT_ID
            # 必须设置 v1 兼容期 deadline，否则 v1 key 在生产模式立即失效
            - name: LICENSE_V1_DEADLINE
              value: "2026-12-31T00:00:00.000Z"
            # cron 鉴权 secret（用 openssl rand -base64 32 生成）
            - name: CRON_SECRET
              valueFrom:
                secretKeyRef:
                  name: aster-cron
                  key: CRON_SECRET
```

### Docker Secret 示例

```bash
printf '%s' 'aster-ent-v2-lic-2026-01-<payload>.<signature>' \
  | docker secret create aster_license_key -
```

```yaml
services:
  aster-cloud:
    image: registry.example.com/aster-cloud:on-prem
    secrets:
      - aster_license_key
    environment:
      LICENSE_KEY_FILE: /run/secrets/aster_license_key
secrets:
  aster_license_key:
    external: true
```

<!-- glossary:block id=license-management-docker-secret-paragraph-14 -->
如运行时只支持环境变量，请在容器 entrypoint 中读取 secret 文件并 export `LICENSE_KEY`。
<!-- /glossary:block -->

---

## 3. UI 状态参考

<!-- glossary:block id=license-management-3-ui-paragraph-15 -->
打开 `/admin/license` 查看当前 license 状态。displayStatus 字段共 11 种：
<!-- /glossary:block -->

<!-- glossary:block id=license-management-3-ui-paragraph-16 -->
| 状态 | 含义 | 处理方式 |
|---|---|---|
| `missing` | 未设置 `LICENSE_KEY` | 注入 license secret 后重启 |
| `malformed` | 格式错误、payload 不合法、未到 `notBefore` 或 v1 已过兼容期 | 核对完整 key；联系 Aster 重新签发 |
| `legacy-unsigned` | v1 unsigned key 仍在 30 天兼容窗口内 | 尽快申请 v2 key；v1 **不用于授权**判断 |
| `signature-invalid` | payload 或签名被篡改，或运行时 Ed25519 不可用 | 检查复制过程、版本和运行时；联系 support |
| `signature-untrusted-key` | keyId 不在当前 build 的 trust bundle 内 | 升级到包含新公钥的 on-prem build |
| `verified-revoked` | license 已在签名撤销列表中 | 联系 Aster support 或销售 |
| `verified-expired` | license 已过期 | 续期并替换 `LICENSE_KEY` |
| `network-grace-expired` | revocation endpoint 超过 7 天不可达 | 恢复网络访问；后续版本会进入只读降级 |
| `verified-expiring-soon` | 距离过期不足 14 天 | 在到期前续期 |
| `network-grace` | revocation endpoint 暂时不可达，仍在 7 天 grace 内 | 检查代理、防火墙、DNS 和 TLS |
| `verified-active` | license 有效 | 无需处理 |
<!-- /glossary:block -->

<!-- glossary:block id=license-management-3-ui-paragraph-17 -->
UI 只显示一个 primary status banner。附加提示以次要 advisory 行内展示，避免多个 banner 互相冲突。
<!-- /glossary:block -->

---

## 4. 网络要求

<!-- glossary:block id=license-management-4-paragraph-18 -->
Standard SKU 需要周期访问 license payload 中的 `revocationCheckUrl`，通常为：
<!-- /glossary:block -->

```text
https://license.aster-lang.cloud/revoked.json
```

防火墙要求：

<!-- glossary:block id=license-management-4-list-item-19 -->
- 允许 HTTPS 443 出站到目标域名
<!-- /glossary:block -->
<!-- glossary:block id=license-management-4-list-item-20 -->
- 允许目标域名的 DNS 解析
<!-- /glossary:block -->
<!-- glossary:block id=license-management-4-list-item-21 -->
- **不要**替换或降级 TLS 证书（中间人会导致签名验证失败 → `network-grace`）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-4-list-item-22 -->
- 如使用企业代理，确保代理透传标准 `fetch` 出站连接（HTTP/1.1 或 HTTP/2）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-4-list-item-23 -->
- 代理可缓存响应（公开签名 JSON 文件，CDN-friendly）
<!-- /glossary:block -->

手工连通性检查：

```bash
curl -fsS https://license.aster-lang.cloud/revoked.json -o /tmp/revoked.json
jq '.version, .publishedAt' /tmp/revoked.json
```

<!-- glossary:block id=license-management-4-paragraph-24 -->
如果客户网络必须通过代理，请在运行平台层配置标准代理环境变量（`HTTPS_PROXY`、`NO_PROXY`）。Aster 不会在 revocation 请求中发送策略内容或用户数据。
<!-- /glossary:block -->

---

## 5. Air-gapped 操作

<!-- glossary:block id=license-management-5-air-gapped-paragraph-25 -->
`sku='air-gapped'` 的 license 在签名 payload 中声明（不由客户本地配置决定）。Air-gapped SKU 会**完全跳过** revocation 网络检查，connectivity 显示为 `not-applicable`。
<!-- /glossary:block -->

Air-gapped 并不表示合同义务被取消。客户仍需要按合同条款管理：

<!-- glossary:block id=license-management-5-air-gapped-list-item-26 -->
- 安装数量（不可在多个 deployment 共享同一 license）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-5-air-gapped-list-item-27 -->
- seat 数量（payload `seatLimit` 字段）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-5-air-gapped-list-item-28 -->
- 续期或迁移流程
<!-- /glossary:block -->

<!-- glossary:block id=license-management-5-air-gapped-paragraph-29 -->
Air-gapped 价格通常为 standard SKU 的 3-5 倍，作为对放弃 revocation 检查的对价补偿。
<!-- /glossary:block -->

---

## 6. Grace period FAQ

<!-- glossary:block id=license-management-6-grace-period-faq-paragraph-30 -->
Standard SKU 在 revocation endpoint 不可达时使用 7 天 grace period（来自 Adobe license model）。
<!-- /glossary:block -->

<!-- glossary:block id=license-management-6-grace-period-faq-paragraph-31 -->
| 距离最近成功检查 | connectivity 状态 |
|---|---|
| 25 小时内 | `fresh` |
| 25 小时 - 7 天 | `grace`（容忍正常网络故障） |
| > 7 天 | `grace-expired` |
| 有 fetch 记录但从未成功 | `error` |
<!-- /glossary:block -->

<!-- glossary:block id=license-management-6-grace-period-faq-paragraph-32 -->
**当前版本只显示状态和告警，不会硬锁登录**。后续 PR 会把 `grace-expired` 映射到只读降级（admin 写操作禁用，用户只读）。
<!-- /glossary:block -->

---

## 7. 续期流程

<!-- glossary:block id=license-management-7-paragraph-33 -->
**v3 起：默认走自助续约 portal**（详见 [`renewal.md`](./renewal.md)）。
ops 在 30/14/7/1 天阈值会收到带 portal 链接的邮件 → 一键 Stripe 支付 →
系统自动签发新 license + 邮件交付。`/admin/license` 页面的 "Renew now"
按钮（当配置了 `NEXT_PUBLIC_LICENSE_RENEWAL_PORTAL_URL` 时）会跳到 portal。
<!-- /glossary:block -->

旧式 sales-managed 续期（仍可用）：

<!-- glossary:block id=license-management-7-list-item-34 -->
1. 联系销售或 support 获取新 v2 license
<!-- /glossary:block -->
<!-- glossary:block id=license-management-7-list-item-35 -->
2. 更新 secret 中的 `LICENSE_KEY`
<!-- /glossary:block -->
<!-- glossary:block id=license-management-7-list-item-36 -->
3. 重启 Aster on-prem 服务（或滚动重启 pods）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-7-list-item-37 -->
4. 打开 admin license 页面确认状态为 `verified-active`
<!-- /glossary:block -->

<!-- glossary:block id=license-management-7-blockquote-38 -->
> 关键：v2/v3 license 都是 Ed25519 签名 payload，签名走 Aster Vault 上的
> license-signing-api（2 人 ceremony 审批或 service-account 自助续约）。
> 客户不能自己签发或延期 license。换 deployment slug 仍需走 sales（自助
> 续约会保留原 binding）。
<!-- /glossary:block -->

---

## 8. Troubleshooting

<!-- glossary:block id=license-management-8-troubleshooting-paragraph-39 -->
| 现象 | 检查项 |
|---|---|
| `missing` | secret 名称、env 注入、容器重启状态、secret 挂载 |
| `malformed` | key 是否完整复制（含 v2 前缀、`.` 分隔的 signature）；是否混入换行；是否 v1 已过 deadline |
| `signature-invalid` | key 是否被截断；是否使用了错误环境的 license；运行时是否支持 Ed25519（Node 20+ / Workers） |
| `signature-untrusted-key` | on-prem build 是否过旧；trust bundle 是否包含 signing key（联系 support 提供新 build） |
| `network-grace` | DNS 解析、HTTPS 出站、企业代理、TLS inspection、CA bundle |
| `network-grace-expired` | 恢复 revocation endpoint 的 HTTPS 出站连接；触发手动 refresh |
| `verified-revoked` | 合同状态、付款、安全撤销原因；联系 support |
| `verified-expired` | 续期 |
<!-- /glossary:block -->

### 手动触发 refresh

<!-- glossary:block id=license-management-refresh-paragraph-40 -->
管理员可在 admin UI 点击 "Refresh now" 按钮，或调用 API：
<!-- /glossary:block -->

```bash
curl -X POST https://your-aster.example.com/api/admin/license/refresh \
  -H 'Cookie: <admin-session-cookie>'
```

Cron 也会每 6 小时自动刷新一次。

### 检查 cron 是否运行

如果 admin UI 显示 `network-grace`，但你确认网络畅通：

```bash
# 直接调 cron endpoint（CRON_SECRET 在 Vault / k8s secret 中）
curl -X POST https://your-aster.example.com/api/cron/license-revocation-refresh \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

<!-- glossary:block id=license-management-cron-paragraph-41 -->
期望返回 `{ "outcome": "updated" | "not-modified", ... }`。
<!-- /glossary:block -->

---

## 9. 审计 hooks

当前版本在 `license_cache` 表中保存：

<!-- glossary:block id=license-management-9-hooks-paragraph-42 -->
| 字段 | 用途 |
|---|---|
| `verified_at` | 上次签名验证时间 |
| `revocation_version` | 上次成功拉取的 list 版本号（单调递增） |
| `revocation_published_at` | server 端 publish 时间 |
| `revocation_fetched_at` | 上次拉取尝试时间 |
| `last_successful_revocation_check_at` | grace timer 基线 |
| `last_revocation_error` | 最近失败的 url/status/reason |
| `is_revoked` | 当前 license 是否在最新 revoked.json 中 |
| `revoked_at` | 撤销时间（如 is_revoked=true） |
| `revoked_reason` | 撤销原因（non-payment / security / ...） |
<!-- /glossary:block -->

<!-- glossary:block id=license-management-9-hooks-paragraph-43 -->
后续 PR-L9 会在 `audit_logs` 表补充结构化事件（license verified、revocation fetched、admin manual refresh），便于 SIEM 集成。
<!-- /glossary:block -->

---

## 10. 隐私保证

Revocation list 只包含：

<!-- glossary:block id=license-management-10-list-item-44 -->
- opaque license id（不可逆推到客户身份）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-10-list-item-45 -->
- 撤销时间
<!-- /glossary:block -->
<!-- glossary:block id=license-management-10-list-item-46 -->
- 撤销原因（5 种枚举值）
<!-- /glossary:block -->

**不包含**：

<!-- glossary:block id=license-management-10-list-item-47 -->
- 客户名称、邮箱、域名
<!-- /glossary:block -->
<!-- glossary:block id=license-management-10-list-item-48 -->
- seat 数、使用量、策略内容
<!-- /glossary:block -->
<!-- glossary:block id=license-management-10-list-item-49 -->
- 任何环境指纹或 telemetry 数据
<!-- /glossary:block -->

<!-- glossary:block id=license-management-10-paragraph-50 -->
客户名称只存在于本地 license payload 中，供 admin UI 展示。Aster 不通过 revocation fetch 收集用户、策略、调用量或环境信息。
<!-- /glossary:block -->

---

## 11. 从 v1 迁移

<!-- glossary:block id=license-management-11-v1-paragraph-51 -->
PR-8 的 v1 unsigned key 在 30 天兼容窗口内显示为 `legacy-unsigned`。**v1 不能用于授权判断**（features 字段无签名保护，可被任意伪造）。
<!-- /glossary:block -->

<!-- glossary:block id=license-management-11-v1-blockquote-52 -->
> **生产部署 checklist**：必须设置 `LICENSE_V1_DEADLINE` env 为绝对 ISO 时间。若未设置，生产模式下 v1 立即失效（fail-closed default）。
<!-- /glossary:block -->

迁移步骤：

<!-- glossary:block id=license-management-11-v1-list-item-53 -->
1. 在 admin license 页面确认当前状态（应该是 `legacy-unsigned`）
<!-- /glossary:block -->
<!-- glossary:block id=license-management-11-v1-list-item-54 -->
2. 联系 support@aster-lang.cloud 申请 v2 key
<!-- /glossary:block -->
<!-- glossary:block id=license-management-11-v1-list-item-55 -->
3. 替换 `LICENSE_KEY` 为新 v2 key
<!-- /glossary:block -->
<!-- glossary:block id=license-management-11-v1-list-item-56 -->
4. 重启服务并确认 `verified-active`
<!-- /glossary:block -->

---

## 12. 联系支持

```text
support@aster-lang.cloud
```

<!-- glossary:block id=license-management-12-paragraph-57 -->
提交 support 请求时，请提供以下信息（在 admin license 页面 "Support diagnostics" 折叠面板可查）：
<!-- /glossary:block -->

<!-- glossary:block id=license-management-12-list-item-58 -->
- `displayStatus`
<!-- /glossary:block -->
<!-- glossary:block id=license-management-12-list-item-59 -->
- `diagnostics.reasonCode`
<!-- /glossary:block -->
<!-- glossary:block id=license-management-12-list-item-60 -->
- `revocationVersion` 和 `lastCheckAt`
<!-- /glossary:block -->
<!-- glossary:block id=license-management-12-list-item-61 -->
- `signingKeyId` 和 `fingerprint`
<!-- /glossary:block -->
<!-- glossary:block id=license-management-12-list-item-62 -->
- 部署方式（k8s / docker / VM）、Aster 版本号和网络拓扑摘要
<!-- /glossary:block -->

<!-- glossary:block id=license-management-12-paragraph-63 -->
**不要**通过邮件发送 LICENSE_KEY 全文、CRON_SECRET 或数据库 dump。License key 应通过 Aster support 指定的加密渠道提交。
<!-- /glossary:block -->

---

## 13. 安全模型摘要

<!-- glossary:block id=license-management-13-paragraph-64 -->
| 防护 | 实现 |
|---|---|
| 防伪造 license | Ed25519 签名 + 嵌入的 trust bundle 公钥 |
| 防 v1 篡改 | hasLicenseFeature 在 v1 路径永远 false |
| 防 small-order key forgery | trust bundle 在启动时拒绝已知 low-order 公钥 |
| 防 revocation 倒退 | version 单调递增，BigInt 比较 |
| 防 stale revocation | validUntil 校验 + grace period 软降级 |
| 防 network MITM | HTTPS-only + Ed25519 签名（不依赖 TLS 信任链） |
| 防 v1 兼容窗口扩张 | LICENSE_V1_DEADLINE 在生产模式 fail-closed |
| 防 keyId 歧义攻击 | 解析按 trust bundle 已知 keyId 前缀匹配 |
| 不强制 phone-home | 完全离线友好；标准 SKU 只 GET 公开签名文件 |
<!-- /glossary:block -->

<!-- glossary:block id=license-management-13-paragraph-65 -->
详见 `.claude/plan/license-system-v2.md` 设计文档。
<!-- /glossary:block -->
