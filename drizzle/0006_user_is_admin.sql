-- Decouple admin from plan.
--
-- 之前 admin-auth.ts 用 `plan === 'enterprise'` 当 admin（临时方案）。
-- 这意味着第一个真实付费的 enterprise 客户的 owner 自动获得
-- /admin/risk-tier 等页面权限 —— 能看到全平台用户列表（数据泄露）。
--
-- 改成专门 isAdmin boolean 字段。默认 false；只能通过 SQL 手动 set true。
--
-- Backfill 策略：目前 service@wontlost.com（创始人）应是唯一 admin；
-- 不在此 migration 直接 set true（让 DBA 手动确认目标 userId 后执行）。

ALTER TABLE "User"
    ADD COLUMN IF NOT EXISTS "isAdmin" boolean NOT NULL DEFAULT false;

-- Operator runbook: 把创始人账号设成 admin
--   UPDATE "User" SET "isAdmin" = true WHERE email = 'service@wontlost.com';
