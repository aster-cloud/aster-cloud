-- Phase 4：拆分 AiKeyBinding 的"最近使用"语义。
-- lastUsedAt = 最近一次真实推理使用（recordAiUsage 在 BYOK 成功推理时 stamp）；
-- lastCheckedAt = 最近一次 healthcheck cron 成功 ping（非真实推理）。
-- 此前 healthcheck 也写 lastUsedAt，导致 dashboard "最近使用" 把 ping 冒充成使用。
ALTER TABLE "AiKeyBinding" ADD COLUMN "lastCheckedAt" timestamp;--> statement-breakpoint
-- 存量清洗：本迁移前 lastUsedAt 全部由 healthcheck ping 写入（真实推理 stamp 是 Phase 3/4
-- 才引入、此前从未发生）。把旧值迁到 lastCheckedAt、清空 lastUsedAt，使历史也语义诚实
-- （dashboard "最近使用" 不再对存量用户显示 ping 时间）。
UPDATE "AiKeyBinding" SET "lastCheckedAt" = "lastUsedAt", "lastUsedAt" = NULL WHERE "lastUsedAt" IS NOT NULL;
