-- Per-team UI language allow-list.
--
-- jsonb array of locale codes (e.g. ['en','hi']) that a team's owner/admin
-- has chosen to expose to that team's users. NULL = unconfigured = all
-- backend-available locales are open (default; does not disturb existing
-- teams). The language switcher's available set =
-- compiled-supported ∩ backend-available ∩ this allow-list
-- (the third term is skipped when the column is NULL).

-- 幂等：与 0021-0023 同款 IF NOT EXISTS。生产 DB 在追踪表记录之前已手动/push
-- 施加过本列（__drizzle_migrations 漂移），裸 ADD COLUMN 重跑会撞 42701
-- (column already exists) 致 migrate Job 失败 → ArgoCD Failed Sync。加 IF NOT EXISTS
-- 让 migrator 幂等跳过已存在列并补登追踪记录。
ALTER TABLE "Team" ADD COLUMN IF NOT EXISTS "enabledLocales" jsonb;
