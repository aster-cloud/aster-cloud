# Security Self-Audit (OWASP Top 10 2021)

> P0-8 of phase4-p0-production-hardening.md
> 审计日期：2026-05-12
> 审计人：Ryan
> 范围：aster-cloud (https://aster-lang.cloud) + aster-api (https://policy.aster-lang.dev)

---

## 自查清单

### A01:2021 - Broken Access Control

| 检查项 | 状态 | 证据 |
|---|---|---|
| 强制服务端鉴权（前端不可绕过） | ✅ | `auth.ts` middleware; `requireAuth()` in API routes |
| Multi-tenant 隔离（用户只看自家数据） | ✅ | aster-api `TenantFilter.java` 强制 X-Tenant-Id header; aster-cloud teamId in query where clause |
| IDOR（直接对象引用） | ⚠️ | 部分 `/api/policies/<id>` 端点需复审 teamId 校验 |
| 默认 deny + 显式 allow | ✅ | aster-api `RoleEnforcementFilter` |
| CORS 白名单（非通配） | ✅ | `CorsFilter` 列具体 origin |
| 后台/管理端点保护 | ✅ | authentik forward-auth |

**行动**：
- [ ] 复审 aster-cloud `/api/policies/[id]/*` 路由的 teamId 校验

### A02:2021 - Cryptographic Failures

| 检查项 | 状态 | 证据 |
|---|---|---|
| 全站 HTTPS（HSTS） | ✅ | cert-manager + letsencrypt-prod |
| 密码哈希（bcrypt / argon2） | ✅ | `bcryptjs` cost 12 in `auth.ts` |
| Session secret 高熵 | ✅ | AUTH_SECRET 通过 Vault 注入 |
| BYOK API keys 加密存储 | ✅ | AES-GCM with `KEY_ENCRYPTION_SECRET` |
| TLS 1.2+ only | ✅ | Cloudflare 默认 |
| 敏感数据日志脱敏 | ⚠️ | aster-api LLM 日志未确认 redact API key |

**行动**：
- [ ] grep `LOG.info` in `io.aster.llm` 看是否泄露 prompt/key

### A03:2021 - Injection

| 检查项 | 状态 | 证据 |
|---|---|---|
| SQL injection（ORM 参数化） | ✅ | Drizzle ORM + Hibernate Panache 全用参数化 |
| Command injection | ✅ | 无 `child_process` / `Runtime.exec` 用户输入路径 |
| LDAP / XPath injection | N/A | 不用 LDAP |
| NoSQL injection | N/A | 不用 NoSQL |
| XSS（输入转义 + CSP） | ✅ | React 默认转义 + `Content-Security-Policy` meta |
| CRLF / Header injection | ⚠️ | aster-api 透传 X-Tenant-Id 等，需验证字符集 |

**行动**：
- [ ] 在 `TenantFilter` 验证 X-Tenant-Id 字符（已有 strict-format，复查）

### A04:2021 - Insecure Design

| 检查项 | 状态 |
|---|---|
| 速率限制（per-IP + per-account） | ✅ aster-api `RateLimitFilter` + Cloudflare WAF |
| 多因素认证 | ⚠️ 未实现（aster-cloud 仅密码 / OAuth） |
| 业务流程逻辑测试 | ⚠️ 待 P1 |

**行动**：
- [ ] 评估 TOTP MFA 接入 Auth.js v5 的成本（推到 P1）

### A05:2021 - Security Misconfiguration

| 检查项 | 状态 | 证据 |
|---|---|---|
| 错误堆栈不暴露给用户 | ✅ | Quarkus prod profile / Next.js prod build |
| 默认密码/账号已清理 | ✅ | Grafana admin 密码由 helm chart 随机生成；prod 无 dev fixtures |
| 不必要的 HTTP method 已禁 | ✅ | RestEasy/Next.js 按路由声明 |
| Security headers（HSTS / X-Content-Type / X-Frame） | ⚠️ | 部分由 CF 加，部分由 next.config 加，需统一 |
| 容器以非 root 运行 | ✅ | 所有 deployment runAsNonRoot |
| K8s 资源 limit 设置 | ✅ | 所有 deployment 有 limits |
| Secret 不在 image / env / log | ✅ | Vault + ExternalSecret，无硬编码 |

**行动**：
- [ ] 统一 security headers（CSP / HSTS / Referrer-Policy）到 Cloudflare Transform Rules

### A06:2021 - Vulnerable & Outdated Components

| 检查项 | 状态 |
|---|---|
| npm audit 0 high/critical | ⚠️ 待跑 |
| gradle dependency check | ⚠️ 待跑 |
| 基础镜像 freshness | ✅ UBI 9 / node:25 / postgres:17（< 6 月） |
| Dependabot / Renovate | ❌ 未启用 |

**行动**：
- [ ] `cd aster-cloud && pnpm audit --audit-level=high`
- [ ] `cd aster-api && ./gradlew dependencyCheckAnalyze`（如 plugin 已配）
- [ ] 启用 Renovate Bot（属 P3-23 任务）

### A07:2021 - Identification & Authentication Failures

| 检查项 | 状态 | 证据 |
|---|---|---|
| 账户锁定（暴力破解防护） | ✅ | `account-lockout.ts` |
| Session timeout | ✅ | JWT 默认 7d；可配 |
| 强密码策略 | ⚠️ | UI 强度提示，但服务端未强制最小要求 |
| 凭证泄露监测（haveibeenpwned） | ❌ | 未集成 |
| 注册防多账号（同邮箱归一） | ✅ | `email-normalize.ts` + `signupIpHash` |
| 一次性邮箱拦截 | ✅ | `email-disposable.ts` |

**行动**：
- [ ] 服务端强制密码 ≥ 8 字符 + 3 类字符
- [ ] HIBP API 集成（推到 P1）

### A08:2021 - Software & Data Integrity Failures

| 检查项 | 状态 |
|---|---|
| CI 镜像签名 | ❌ 未启用 cosign |
| ArgoCD ApplicationSet/Application git pin | ✅ targetRevision: main（建议改 tag/sha） |
| pnpm-lock.yaml / gradle.lockfile committed | ✅ |
| Audit log（aster-api） | ✅ `AuditLog` + hash chain |

**行动**：
- [ ] 评估 cosign 接入 deploy workflow（推到 P3）

### A09:2021 - Security Logging & Monitoring Failures

| 检查项 | 状态 |
|---|---|
| 关键事件日志（登录失败、权限拒绝、5xx） | ✅ aster-api `SecurityEventService` |
| 日志 retention | ✅ K8s 默认 + Loki 待加 |
| 告警（异常登录、横向移动） | ⚠️ 现有 SLO/NSM alert 但无安全 alert |
| 日志完整性（hash chain） | ✅ |

**行动**：
- [ ] 加 PrometheusRule：登录失败率 / signature verify failure 异常增

### A10:2021 - SSRF

| 检查项 | 状态 |
|---|---|
| 外部 URL fetch（用户输入） | ⚠️ AI Explain 可能给定 URL 反向访问内部？复查 |
| LLM provider URL 白名单 | ✅ ConfigMapping 写死 |

**行动**：
- [ ] 验证 `VertxLlmClient.resolveChatPath` 仅接受预定义 host

---

## 自动化扫描（待执行）

```bash
# Nuclei
nuclei -u https://aster-lang.cloud -severity critical,high,medium \
  -o nuclei-aster-lang.cloud.txt

nuclei -u https://policy.aster-lang.dev -severity critical,high,medium \
  -o nuclei-policy.aster-lang.dev.txt

# ZAP baseline（unauthenticated）
docker run --rm -v $(pwd):/zap/wrk:rw \
  -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://aster-lang.cloud \
  -r zap-aster-lang.cloud.html

docker run --rm -v $(pwd):/zap/wrk:rw \
  -t ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t https://policy.aster-lang.dev \
  -r zap-policy.aster-lang.dev.html
```

报告归档到 `aster-cloud/docs/security/<date>-{nuclei,zap}.{txt,html}`。

---

## Critical / High 修复跟踪

| ID | 严重度 | 来源 | 描述 | 状态 |
|---|---|---|---|---|
| — | — | — | （首次审计，自动扫描待跑） | — |

---

## 复审节奏

- 重大变更后立即跑自动扫描
- 季度执行完整 Top 10 自查
- 半年请外部 pentest（runway 允许时）
