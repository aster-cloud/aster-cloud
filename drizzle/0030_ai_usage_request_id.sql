-- issue #185：AI usage 精确 token 计量。AiUsageRecord 加 requestId + 唯一索引，
-- 供 cloud 用 requestId upsert（占位 0/0 + aster-api 回填真实 token = 同一行，不双记账）。
ALTER TABLE "AiUsageRecord" ADD COLUMN "requestId" text;--> statement-breakpoint
-- 普通唯一索引：标准 Postgres 多个 NULL 互不相等 → 无 requestId 记录不受约束、仍可多行；
-- 且 ON CONFLICT ("requestId") 可直接用于 upsert（部分索引需重复 WHERE 谓词）。
CREATE UNIQUE INDEX "AiUsage_requestId_unique" ON "AiUsageRecord" ("requestId");
