-- P0-A 决策级持久层（ADR 0030 附录 A.1）——回归工具的回放地基。
-- 给 Execution 表加回放完整性列：不可变版本引用 / functionName / locale / aliasSet /
-- vocabSnapshot / toolchain / reasonCodes / trace(+hash) / canonical*Hash / replayability
-- 状态 / PII envelope 加密占位（KMS 接线前留空）。全 nullable（兼容历史行）。
--
-- ★手写精确迁移（非 drizzle-kit generate）：schema.ts 领先 migration snapshot 存在既有
-- 漂移，drizzle-kit generate 会产大量无关表迁移（CronJobLease/DomainTerm/... 可能破坏生产）。
-- 只加 Execution 列 + 索引，零副作用。
--
-- 锁风险评估：全 ADD COLUMN nullable 无默认 = PG 11+ 元数据操作，不重写全表、不长锁。
-- 索引在小规模 Execution 表（历史 ~900 行）非 concurrent 也无实质锁风险；若未来表显著
-- 增大，索引应改 CREATE INDEX CONCURRENTLY（单独非事务迁移）。

ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "policyVersionRowId" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "functionName" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "locale" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "aliasSetJson" json;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "vocabSnapshotRef" json;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "sourceToolchainId" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "runtimeToolchainId" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "reasonCodes" json;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "traceJson" json;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "traceHash" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "canonicalInputHash" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "canonicalOutputHash" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "canonicalizationVersion" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayCaptureVersion" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayabilityStatus" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayabilityReasons" json;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayPayloadCiphertext" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayPayloadAlg" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayPayloadKeyId" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayPayloadNonce" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "replayPayloadHash" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "piiRetentionUntil" timestamp;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "piiPolicyVersion" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Execution_policyVersionRowId_idx" ON "Execution" USING btree ("policyVersionRowId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Execution_replayabilityStatus_idx" ON "Execution" USING btree ("replayabilityStatus");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Execution_canonicalInputHash_idx" ON "Execution" USING btree ("canonicalInputHash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Execution_canonicalOutputHash_idx" ON "Execution" USING btree ("canonicalOutputHash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Execution_traceHash_idx" ON "Execution" USING btree ("traceHash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Execution_piiRetentionUntil_idx" ON "Execution" USING btree ("piiRetentionUntil");
