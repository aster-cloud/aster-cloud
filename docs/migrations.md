# Aster Cloud 数据库迁移

> P0-4 of phase4-p0-production-hardening.md

## 现状

- ORM：Drizzle（`drizzle/*.sql` 是 source of truth）
- Migration 跟踪：`__drizzle_migrations` 表（drizzle-kit 自动维护）
- 迁移环境：K8s Job（不是 Cloudflare Pages build hook）

## 完整流程

```
schema 修改 → pnpm db:generate → drizzle/00XX.sql → commit + push
                                                        ↓
                            CI build & push wontlost/aster-cloud-migrate:<sha>
                                                        ↓
                            ArgoCD sync 触发 PreSync Job (kustomization 中 migrate-job.yaml)
                                                        ↓
                                  Job 拉新镜像、跑 drizzle-kit migrate
                                                        ↓
                              成功 → ArgoCD 继续同步主 Application
                              失败 → ArgoCD sync 停在 PreSync 阶段，主 deployment 不被替换
```

## 本地开发

```bash
# 1. 修改 src/db/schema.ts
# 2. 生成 SQL
pnpm db:generate
# 检查 drizzle/0XXX_*.sql 是否符合预期
# 3. 对本地 PG 应用
DATABASE_URL="postgresql://localhost:5432/aster_cloud_dev" pnpm db:migrate
```

## 手动应用到生产（紧急情况）

正常应走 CI → ArgoCD。如确需手动：

```bash
# 触发一次性 Job
kubectl -n aster-cloud create job aster-cloud-migrate-$(date +%s) \
  --from=job/aster-cloud-migrate

# 查看日志
kubectl -n aster-cloud logs -l app=aster-cloud-migrate --tail=200
```

## 历史迁移

| # | 文件 | 应用方式 | 备注 |
|---|------|---------|------|
| 0001 | grandfather_legacy_tier.sql | kubectl exec（手动） | Phase 3 legacy tier 字段 |
| 0002 | ai_billing.sql | kubectl exec（手动） | AI 计费列 |
| 0003 | user_columns_resync.sql | kubectl exec（手动） | 修补 schema drift（恢复 SSO） |
| 0004+ | — | Job (自动) | P0-4 之后均走 Job |

## 回滚

drizzle 不支持自动 down migration。回滚策略：
1. 在新迁移文件 `00XX_revert.sql` 写反向 SQL
2. 走正常流程发布
3. 若紧急：用 P0-6 的 PG 备份恢复

## 故障排查

| 症状 | 排查 |
|------|------|
| Job 失败，退出码 2 | drizzle 内部错误，看 stderr。常见：column already exists（迁移文件不幂等） |
| Job 失败，退出码 1 | DATABASE_URL 未设。检查 aster-cloud-db-credentials secret |
| ArgoCD 卡在 PreSync | Job 还在跑或失败。`kubectl -n aster-cloud get job` |
| Vault 中无 data-services/aster-cloud-db | 写入 `vault kv put secret/data-services/aster-cloud-db database=aster_cloud username=aster password=<pwd>` |

## 安全

- 迁移用户应有 CREATE/ALTER 权限，但**不需要** SUPERUSER
- 生产 PG user 是 `aster_api_user`，由 cloudnative-pg 创建时配的角色
- 迁移容器 `runAsUser: 1000`，无 host 网络访问

## drizzle schema 权限（一次性 setup）

drizzle 在自己的 `drizzle` schema 下管理 `__drizzle_migrations` 表。
首次部署时由 postgres superuser 创建 schema，需要 grant 权限给业务 user：

```sql
GRANT USAGE, CREATE ON SCHEMA drizzle TO aster_api_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA drizzle TO aster_api_user;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA drizzle TO aster_api_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aster_api_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA drizzle GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO aster_api_user;
```

已在生产执行（2026-05-12）。
