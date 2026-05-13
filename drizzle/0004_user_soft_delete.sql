-- Phase 4 user soft-delete + 30d grace + same-identity reactivation
--
-- 之前 DELETE /api/user/delete 物理删除 user 行，同邮箱重新注册 = 全新账户。
-- 用户体验差且不符合 GDPR 推荐做法（30 天可撤销窗口）。
--
-- 新模型：
--   - deletedAt 非空 → 墓碑状态，signIn 拒绝
--   - purgePendingUntil = deletedAt + 30d，cron 到点真删
--   - 墓碑期内同邮箱再登 → 清 deletedAt 复活，user.id 不变
--   - hard-purge 时把 priorPurgeCount 累计转移给"该归一邮箱的下次注册"
--     （通过 audit 表查；此 migration 仅添加列）
--
-- 幂等：ADD COLUMN IF NOT EXISTS
ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "deletedAt" timestamp,
    ADD COLUMN IF NOT EXISTS "purgePendingUntil" timestamp,
    ADD COLUMN IF NOT EXISTS "reactivationCount" integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS "priorPurgeCount" integer NOT NULL DEFAULT 0;

-- cron 用：扫到 now() > purgePendingUntil 的所有墓碑用户做 hard-purge
CREATE INDEX IF NOT EXISTS "User_purgePendingUntil_idx"
    ON "User" ("purgePendingUntil")
    WHERE "purgePendingUntil" IS NOT NULL;
