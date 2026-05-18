# On-prem License 管理指南

本文档面向 Aster on-prem 部署管理员，说明如何安装、续期、排查和审计企业 license。

---

## 1. 概览

Aster on-prem license 用于决定：

- license 是否由 Aster 签发并通过 Ed25519 验签
- license 是否过期、即将过期或已撤销
- seat 上限、套餐档位（tier）和已启用功能（features）
- standard SKU 是否需要周期性拉取公开的 revocation list

License **不做**以下事情：

- 不上传策略内容、用户数据或执行日志
- 不把客户环境指纹发回 Aster
- 不作为 phone-home telemetry channel
- 不替代合同、采购或安全审批流程

Standard SKU 会访问公开的 revocation endpoint，只下载签名 JSON 文件。该文件只包含 opaque license id，不包含客户名称、邮箱、域名或使用量。

---

## 2. 设置 LICENSE_KEY + ASTER_DEPLOYMENT_ID

每张签名 license 都绑定到一个具体部署（v3 起为**强制**）。客户需要配两个环境变量：

```bash
LICENSE_KEY='aster-ent-v2-lic-2026-01-<payload>.<signature>'
ASTER_DEPLOYMENT_ID='<sha256-hex>'   # Aster 签发时一并交付，64 lowercase hex
```

`ASTER_DEPLOYMENT_ID` = `sha256(<customer>|<deployment-slug>)`。Aster 签发流程
（`scripts/license-issue.sh`）会在终端打印这串 hex；销售把 license key + 这串 id
一起加密交付给你。**如果你把同一张 license 装到不止一个集群，只有 ASTER_DEPLOYMENT_ID
匹配的那个能跑** —— 其他集群会进入 `binding-mismatch` read-only 状态。

生产环境**不要**把 license 写进镜像。请使用 secret 管理系统注入环境变量。

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

如运行时只支持环境变量，请在容器 entrypoint 中读取 secret 文件并 export `LICENSE_KEY`。

---

## 3. UI 状态参考

打开 `/admin/license` 查看当前 license 状态。displayStatus 字段共 11 种：

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

UI 只显示一个 primary status banner。附加提示以次要 advisory 行内展示，避免多个 banner 互相冲突。

---

## 4. 网络要求

Standard SKU 需要周期访问 license payload 中的 `revocationCheckUrl`，通常为：

```text
https://license.aster-lang.cloud/revoked.json
```

防火墙要求：

- 允许 HTTPS 443 出站到目标域名
- 允许目标域名的 DNS 解析
- **不要**替换或降级 TLS 证书（中间人会导致签名验证失败 → `network-grace`）
- 如使用企业代理，确保代理透传标准 `fetch` 出站连接（HTTP/1.1 或 HTTP/2）
- 代理可缓存响应（公开签名 JSON 文件，CDN-friendly）

手工连通性检查：

```bash
curl -fsS https://license.aster-lang.cloud/revoked.json -o /tmp/revoked.json
jq '.version, .publishedAt' /tmp/revoked.json
```

如果客户网络必须通过代理，请在运行平台层配置标准代理环境变量（`HTTPS_PROXY`、`NO_PROXY`）。Aster 不会在 revocation 请求中发送策略内容或用户数据。

---

## 5. Air-gapped 操作

`sku='air-gapped'` 的 license 在签名 payload 中声明（不由客户本地配置决定）。Air-gapped SKU 会**完全跳过** revocation 网络检查，connectivity 显示为 `not-applicable`。

Air-gapped 并不表示合同义务被取消。客户仍需要按合同条款管理：

- 安装数量（不可在多个 deployment 共享同一 license）
- seat 数量（payload `seatLimit` 字段）
- 续期或迁移流程

Air-gapped 价格通常为 standard SKU 的 3-5 倍，作为对放弃 revocation 检查的对价补偿。

---

## 6. Grace period FAQ

Standard SKU 在 revocation endpoint 不可达时使用 7 天 grace period（来自 Adobe license model）。

| 距离最近成功检查 | connectivity 状态 |
|---|---|
| 25 小时内 | `fresh` |
| 25 小时 - 7 天 | `grace`（容忍正常网络故障） |
| > 7 天 | `grace-expired` |
| 有 fetch 记录但从未成功 | `error` |

**当前版本只显示状态和告警，不会硬锁登录**。后续 PR 会把 `grace-expired` 映射到只读降级（admin 写操作禁用，用户只读）。

---

## 7. 续期流程

建议在到期前 60 天联系销售续期。系统会在剩余不足 14 天时显示 `verified-expiring-soon`。

续期步骤：

1. 联系销售或 support 获取新 v2 license
2. 更新 secret 中的 `LICENSE_KEY`
3. 重启 Aster on-prem 服务（或滚动重启 pods）
4. 打开 admin license 页面确认状态为 `verified-active`

> 关键：v2 license 是 Ed25519 签名 payload，签名工具在 Aster Vault 上运行（2 人 ceremony 审批）。客户不能自己签发或延期 license。

---

## 8. Troubleshooting

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

### 手动触发 refresh

管理员可在 admin UI 点击 "Refresh now" 按钮，或调用 API：

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

期望返回 `{ "outcome": "updated" | "not-modified", ... }`。

---

## 9. 审计 hooks

当前版本在 `license_cache` 表中保存：

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

后续 PR-L9 会在 `audit_logs` 表补充结构化事件（license verified、revocation fetched、admin manual refresh），便于 SIEM 集成。

---

## 10. 隐私保证

Revocation list 只包含：

- opaque license id（不可逆推到客户身份）
- 撤销时间
- 撤销原因（5 种枚举值）

**不包含**：

- 客户名称、邮箱、域名
- seat 数、使用量、策略内容
- 任何环境指纹或 telemetry 数据

客户名称只存在于本地 license payload 中，供 admin UI 展示。Aster 不通过 revocation fetch 收集用户、策略、调用量或环境信息。

---

## 11. 从 v1 迁移

PR-8 的 v1 unsigned key 在 30 天兼容窗口内显示为 `legacy-unsigned`。**v1 不能用于授权判断**（features 字段无签名保护，可被任意伪造）。

> **生产部署 checklist**：必须设置 `LICENSE_V1_DEADLINE` env 为绝对 ISO 时间。若未设置，生产模式下 v1 立即失效（fail-closed default）。

迁移步骤：

1. 在 admin license 页面确认当前状态（应该是 `legacy-unsigned`）
2. 联系 support@aster-lang.cloud 申请 v2 key
3. 替换 `LICENSE_KEY` 为新 v2 key
4. 重启服务并确认 `verified-active`

---

## 12. 联系支持

```text
support@aster-lang.cloud
```

提交 support 请求时，请提供以下信息（在 admin license 页面 "Support diagnostics" 折叠面板可查）：

- `displayStatus`
- `diagnostics.reasonCode`
- `revocationVersion` 和 `lastCheckAt`
- `signingKeyId` 和 `fingerprint`
- 部署方式（k8s / docker / VM）、Aster 版本号和网络拓扑摘要

**不要**通过邮件发送 LICENSE_KEY 全文、CRON_SECRET 或数据库 dump。License key 应通过 Aster support 指定的加密渠道提交。

---

## 13. 安全模型摘要

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

详见 `.claude/plan/license-system-v2.md` 设计文档。
