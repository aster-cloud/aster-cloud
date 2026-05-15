-- ============================================================================
-- 0008: 补 SignupAttempt 表 —— 注册限流计数
-- ============================================================================
--
-- 背景：schema.ts 在 `signupAttempts` 声明了 SignupAttempt 表，
-- 但没有 migration 创建它。signIn callback 里的 checkSignupRateLimit()
-- 会查这张表；缺失时查询抛 42P01 (undefined_table)，NextAuth 捕获后
-- 重定向到 /login?error=AccessDenied —— 用户看到泛化错误，根本不是
-- "账号已删除" 也不是 "速率超限"，而是 "DB 缺表"。
--
-- 事故复盘：2026-05-15 用户用 GitHub OAuth 登录，Worker 日志显示
-- relation "SignupAttempt" does not exist (code 42P01) → AccessDenied。
-- ============================================================================

CREATE TABLE IF NOT EXISTS "SignupAttempt" (
    "id" text PRIMARY KEY NOT NULL,
    "ipHash" text NOT NULL,
    "succeeded" boolean NOT NULL DEFAULT false,
    "createdAt" timestamp NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "SignupAttempt_ipHash_createdAt_idx"
    ON "SignupAttempt" ("ipHash", "createdAt");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "SignupAttempt_createdAt_idx"
    ON "SignupAttempt" ("createdAt");
--> statement-breakpoint

COMMENT ON TABLE "SignupAttempt" IS
    '注册限流计数：SHA256(ip+salt) 24h 窗口内 ≤3 次。详见 src/lib/signup-rate-limit.ts';
