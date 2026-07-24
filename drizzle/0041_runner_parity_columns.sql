-- runner-parity 影子校验结果列（PR-2/4）。
--
-- runner-parity 是 cloud 权威侧 vs runner 侧执行的 5 canonical-hash 字段比对，纯附加、log-only、
-- 绝不 gate 决策（诚实边界：integration/orchestration milestone，非 attestation 增量）。
-- 三列全 nullable，历史行 NULL=未跑 parity（历史 / mode=off / 未采样）。异步 waitUntil 回写。
--
-- runnerParityStatus: match | divergent | runner-unavailable | runner-error | authority-failure。
-- runnerParityDivergentFields: divergent 时不一致字段名 string[] JSON。
-- runnerParityCheckedAt: parity 完成时刻（NULL=未跑）。
-- 部分索引：只索引 NON-NULL（已跑）行，查 divergent/error 快；大量 NULL 未跑行不占索引。

ALTER TABLE "Execution" ADD COLUMN "runnerParityStatus" text;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN "runnerParityDivergentFields" json;--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN "runnerParityCheckedAt" timestamp;--> statement-breakpoint
CREATE INDEX "Execution_runnerParityStatus_idx" ON "Execution" USING btree ("runnerParityStatus") WHERE "Execution"."runnerParityStatus" IS NOT NULL;
