# Aster Cloud 企业级部署指南

本文档面向企业平台团队、SRE、安全团队和审计团队。客户日常 license 操作请参考 `docs/on-prem/license-management.md`。

## 1. 概览与威胁模型

Aster Cloud on-prem 运行在客户环境。Aster SaaS 端负责签发 license、发布签名 revocation manifest 和提供支持。

核心信任边界：

- license payload 使用 Ed25519 license key 签名
- revocation manifest 使用独立 Ed25519 revocation key 签名（two-key separation）
- on-prem 镜像只内嵌 public trust bundle，**不包含私钥**
- revocation endpoint 可公开访问；真实性来自签名，不来自 endpoint 访问控制
- license/revocation **不是遥测通道**，不上传客户代码、策略、用户数据或使用量

威胁矩阵：

| 威胁 | 控制 |
|---|---|
| license payload 被篡改 | Ed25519 签名校验 |
| revocation manifest replay | version 单调递增 + cache anti-rollback |
| revocation 网络长期不可达 | 25h fresh / 7d grace / grace-expired → read-only |
| SaaS signing key 泄露 | Vault/KMS 托管 + license/revocation key 分离 + audit |
| signing-api Witness 旁路 | 独立 service 唯一持有 transit/sign 权限 + dual JWT |
| on-prem admin 误操作 | admin gate + audit log + read-only gate |
| 续期遗忘 | 30/14/7/1 days Slack 提醒 cron |

## 2. 前置条件

- K3S 或兼容 Kubernetes 1.29+
- PostgreSQL 15+
- Vault 或等价 KMS（生产签名必经）
- cert-manager（mTLS 证书自动化）
- Prometheus + Grafana（监控告警）
- 日志系统：Loki / OpenSearch / Splunk
- 出站 HTTPS 到 Aster revocation endpoint
- 定期备份 Postgres 和 Kubernetes Secret

## 3. K3S 部署阶段

### 阶段 1：创建命名空间

```bash
kubectl create namespace aster-cloud
kubectl label namespace aster-cloud app.kubernetes.io/part-of=aster
```

### 阶段 2：准备 Postgres database

```sql
CREATE DATABASE aster_cloud;
CREATE USER aster_cloud WITH PASSWORD '<strong>';
GRANT ALL PRIVILEGES ON DATABASE aster_cloud TO aster_cloud;
```

### 阶段 3：配置 Secret

```bash
kubectl -n aster-cloud create secret generic aster-cloud-env \
  --from-literal=DATABASE_URL='postgres://aster_cloud:***@postgres:5432/aster_cloud' \
  --from-literal=NEXTAUTH_SECRET='***' \
  --from-literal=CRON_SECRET='***' \
  --from-literal=LICENSE_KEY='aster-ent-v2-...'
```

### 阶段 4：运行数据库迁移

```bash
kubectl -n aster-cloud run migrate --rm -it \
  --image=docker.io/wontlost/aster-cloud:<version> \
  --env-from=secretRef:name=aster-cloud-env \
  -- pnpm db:migrate
```

### 阶段 5：部署 application

部署 Deployment、Service、Ingress。确认：
- `/api/cron/*` 路由仅允许 cron secret 调用
- `/api/admin/*` 仅允许 admin session
- `/api/admin/metrics` 仅允许 Prometheus scrape

### 阶段 6：配置 cron 触发

Cloudflare Workers 自动触发 wrangler.toml 中声明的 cron。其他环境用 K8s CronJob：

```yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: license-revocation-refresh
  namespace: aster-cloud
spec:
  schedule: "0 */6 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: cron
              image: curlimages/curl:8.10.1
              command:
                - sh
                - -c
                - >-
                  curl -fsS -X POST
                  -H "Authorization: Bearer $CRON_SECRET"
                  http://aster-cloud:3000/api/cron/license-revocation-refresh
              envFrom:
                - secretRef:
                    name: aster-cloud-env
          restartPolicy: OnFailure
```

### 阶段 7：烟测

```bash
curl -fsS https://aster.example.com/api/health
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  -X POST https://aster.example.com/api/cron/license-revocation-refresh
```

打开 `https://aster.example.com/admin/license` 验证 `verified-active`。

## 4. License ceremony reference

License signing ceremony 由 Aster 内部执行。流程：

- `aster-deploy/docs/license-key-ceremony.md`

客户需保存：
- licenseId
- expiresAt
- support contact (`support@aster-lang.cloud`)
- revocation endpoint URL
- trust bundle fingerprint（启动日志可见）

## 5. signing-api 部署 reference

生产签名必经 Vault/KMS 或 signing-api。**禁止**在 SaaS Web 进程持久化私钥。

参考：

- `aster-deploy/services/license-signing-api/`
- `aster-deploy/services/license-signing-api/k8s/`（K3S raw manifests）
- `aster-deploy/services/license-signing-api/helm/`（Helm chart，可分发给客户）

关键控制：
- signing-api 独立 namespace `aster-license-signing`
- Vault policy 只允许 `transit/sign/license-signing-*` 和 `transit/sign/revocation-signing-*` update
- 所有签名请求写 audit log（JSONL + Prometheus + Slack）
- break-glass 操作需要 dual JWT (Operator + Witness)

## 6. SaaS-side revocation endpoint setup

配置：
- DNS：`license.aster-lang.cloud`
- CDN：`Cache-Control: public, max-age=3600, must-revalidate`
- ETag：`"v<version>"`
- TLS：public CA
- Body：signed JSON manifest

on-prem 客户**只信任 manifest 签名**。CDN / DNS / TLS 是可用性 + 传输保护，不是数据根信任。

## 7. Monitoring

导入 Grafana dashboard：

- `docs/on-prem/grafana-license-dashboard.json`

建议告警：

```yaml
- alert: AsterLicenseRevocationStale
  expr: aster_license_cache_age_seconds > 90000
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: Revocation cache older than 25h

- alert: AsterLicenseGraceExpired
  expr: aster_license_cache_age_seconds > 604800
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: License revocation grace window expired (read-only mode)

- alert: AsterLicenseReadOnlyGateActive
  expr: rate(aster_license_read_only_gate_total[5m]) > 0
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: Admin write operations blocked by license gate
```

## 8. Disaster recovery

| 场景 | 恢复动作 |
|---|---|
| license signing key 轮换 | 发布新 trust bundle，旧 key 设为 verify-only，6 个月后 retired |
| revocation key 疑似泄露 | retired 旧 key，发布新 bundle，全量重签 manifest |
| Vault 不可用 | 暂停 publish，保留最后有效 manifest |
| signing-api crash | 恢复 pod，核对 audit log 无缺口 |
| on-prem Postgres 恢复 | 备份恢复后立即执行 revocation refresh |
| revocation endpoint DNS 切换 | client 7d grace 内自动恢复；超时手动 refresh |

## 9. Audit retention

| 数据 | 默认保留 | SOC2 建议 | 说明 |
|---|---|---|---|
| admin license revoke | 7 年 | 7 年 | 合同与安全证据 |
| revocation publish | 7 年 | 7 年 | 可重建 public manifest 历史 |
| on-prem refresh event | 90 天 | 1 年 | 运维排障 |
| signing-api request | 7 年 | 7 年 | 密钥使用证据 |
| license verification metric | 30 天 | 90 天 | Prometheus retention |

## 10. SOC2 control mapping

| Control | 证据位置 | 采集方式 |
|---|---|---|
| CC6.1 access control | admin audit log | `SELECT * FROM AuditLog WHERE action LIKE 'license.%'` |
| CC6.6 encryption / key mgmt | Vault transit config | Vault policy screenshot + ceremony 录屏 |
| CC7.2 monitoring | Grafana dashboard | dashboard export + alert history |
| CC8.1 change management | drizzle migrations | Git PR + CI run history |
| A1 availability | cron logs | log query for `license-revocation-refresh` outcome |

## 11. Customer onboarding checklist

- [ ] 创建 Kubernetes Secret 含 `LICENSE_KEY` `CRON_SECRET` `DATABASE_URL`
- [ ] 配置出站 HTTPS firewall 到 `license.aster-lang.cloud`
- [ ] 部署 application + cron triggers
- [ ] 执行 `/api/cron/license-revocation-refresh` 首次冷启动
- [ ] 打开 `/admin/license` 确认 `verified-active`
- [ ] 导入 Grafana dashboard
- [ ] 配置告警接收人
- [ ] 验证 read-only gate（人为破坏 license 后所有 admin mutate 应被 503）

## 12. Troubleshooting matrix

| 状态 / 错误 | 检查项 | 修复 |
|---|---|---|
| `missing` | `LICENSE_KEY` 未配置 | 更新 Secret 并重启 |
| `malformed` | license 格式或日期错误 | 联系 support 重签 |
| `signature-invalid` | payload 被改或 trust bundle 不匹配 | 检查镜像版本和 license 来源 |
| `signature-untrusted-key` | trust bundle 缺 key | 升级镜像 |
| `verified-expired` | license 到期 | `support@aster-lang.cloud` 续约 |
| `verified-revoked` | license 被撤销 | 联系客户成功团队 |
| `network-grace` | endpoint 暂时不可达 | 检查 proxy / firewall / DNS |
| `network-grace-expired` | 7 天未成功检查 | 恢复网络后手动 refresh |
| `license-read-only-mode` | admin write gate 生效 | 先修复 license 状态再重试 |
| `concurrent-refresh-in-progress` | 多个 refresh 并发 | 正常 — advisory lock 去重；不需处理 |
