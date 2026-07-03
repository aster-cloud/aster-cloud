-- W3（ADR 0022）：同一用户最多一条「活跃」结构词别名授权。
-- 把此前的非唯一 partial index 升级为 partial UNIQUE，从 DB 层杜绝 admin
-- grant 接口 check-then-insert 的 TOCTOU 竞态产生重复活跃行。

-- 1) 去重历史数据：若某用户存在多条 revokedAt IS NULL，仅保留最早授予的一条，
--    其余标记为已撤销（撤销时间取 now），避免唯一索引创建失败。
UPDATE "StructuralAliasGrant" g
SET "revokedAt" = now()
WHERE "revokedAt" IS NULL
  AND EXISTS (
    SELECT 1 FROM "StructuralAliasGrant" k
    WHERE k."userId" = g."userId"
      AND k."revokedAt" IS NULL
      AND (k."grantedAt" < g."grantedAt"
           OR (k."grantedAt" = g."grantedAt" AND k."id" < g."id"))
  );

-- 2) 替换索引：删旧非唯一 partial index，建同名语义的 partial UNIQUE index。
DROP INDEX IF EXISTS "StructuralAliasGrant_active_idx";

CREATE UNIQUE INDEX IF NOT EXISTS "StructuralAliasGrant_active_unique"
  ON "StructuralAliasGrant" ("userId")
  WHERE "revokedAt" IS NULL;
