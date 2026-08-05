-- ADR 0022 后续：executions 加 decision 列，区分准入决策语义（approved/denied/
-- indeterminate/error），与 boolean success 正交（success 仍=allowed 不变）。修复：此前
-- 审计/统计把「值/计算输出」策略（decision=indeterminate，如 greet 返回文本）误计入失败。
--
-- 锁风险评估（上线前实测）：生产 Execution 表 913 行、近 24h 仅 14 次写入，规模极小。
-- 全表 UPDATE + 非 concurrent CREATE INDEX 对此规模无实质锁风险，无需分批/CONCURRENTLY。
-- 若未来表显著增大，回填与建索引应改分批 + CREATE INDEX CONCURRENTLY（单独非事务迁移）。
--
-- 注意：drizzle-kit migrate 按 statement-breakpoint 标记拆分逐条执行；每条须是独立可执行
-- （此处刻意不写出该标记的完整字面量——写出来会被拆分器当成真的分隔符，
--   把本注释从中间切断，导致后半句变成非法 SQL。这正是本文件曾经的 bug。）
-- 语句（DO$$ 块作为单条）。勿把多条 DDL 合成一条，否则报错。
DO $$ BEGIN
  CREATE TYPE "ExecutionDecision" AS ENUM ('approved', 'denied', 'indeterminate', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "decision" "ExecutionDecision";
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "Execution_decision_idx" ON "Execution" ("decision");
--> statement-breakpoint
-- 回填历史行：从 output JSON 派生（与服务端 deriveExecutionDecision 同口径，四态互斥、按优先级）。
-- output 是完整 PolicyExecutionResult：{ allowed, metadata:{ decision, engineError } }，列类型 jsonb。
-- ★保守回填：只对**能明确判定**的行落值（有 engineError/indeterminate 标记，或含布尔 allowed 字段）；
-- 无 allowed 且无标记的非标准 object 留 NULL（不臆断成 denied）。仅回填 decision IS NULL 的行（幂等）。
UPDATE "Execution"
SET "decision" = CASE
    WHEN ("output" -> 'metadata' ->> 'engineError') = 'true' THEN 'error'::"ExecutionDecision"
    WHEN ("output" -> 'metadata' ->> 'decision') = 'indeterminate' THEN 'indeterminate'::"ExecutionDecision"
    WHEN ("output" ->> 'allowed') = 'true' THEN 'approved'::"ExecutionDecision"
    ELSE 'denied'::"ExecutionDecision"
  END
WHERE "decision" IS NULL
  AND "output" IS NOT NULL
  AND jsonb_typeof("output") = 'object'
  AND (
    ("output" -> 'metadata' ->> 'engineError') = 'true'
    OR ("output" -> 'metadata' ->> 'decision') = 'indeterminate'
    OR ("output" -> 'allowed') IS NOT NULL
  );
