-- ADR 0022 后续：executions 加 decision 列，区分准入决策语义（approved/denied/
-- indeterminate/error），与 boolean success 正交（success 仍=allowed 不变）。修复：此前
-- 审计/统计把「值/计算输出」策略（decision=indeterminate，如 greet 返回文本）误计入失败。
--
-- 锁风险评估（上线前实测）：生产 Execution 表 913 行、近 24h 仅 14 次写入，规模极小。
-- 全表 UPDATE + 非 concurrent CREATE INDEX 对此规模无实质锁风险，无需分批/CONCURRENTLY。
-- 若未来表显著增大，回填与建索引应改分批 + CREATE INDEX CONCURRENTLY（单独非事务迁移）。

-- 1) 枚举类型（幂等）。
DO $$ BEGIN
  CREATE TYPE "ExecutionDecision" AS ENUM ('approved', 'denied', 'indeterminate', 'error');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2) 可空列（历史行迁移前无此列 → NULL，随后回填）。
ALTER TABLE "Execution" ADD COLUMN IF NOT EXISTS "decision" "ExecutionDecision";

-- 3) 索引（按 decision 统计/过滤）。
CREATE INDEX IF NOT EXISTS "Execution_decision_idx" ON "Execution" ("decision");

-- 4) 回填历史行：从 output JSON 派生（与服务端 deriveExecutionDecision 同口径，四态互斥、
--    按优先级）。output 是完整 PolicyExecutionResult：{ allowed, metadata:{ decision, engineError } }。
--    仅回填 decision IS NULL 的行（幂等，重跑安全）。
--    ★保守回填：只对**能明确判定**的行落值——即 output 是 object 且含 engineError/indeterminate
--    标记，或含布尔 allowed 字段。无 allowed 且无标记的非标准 object **留 NULL**（不臆断成 denied）。
--    denied 仅在 allowed 明确为非 true（即存在 allowed 字段但不为 true）时落。
-- output 列类型为 json（非 jsonb）→ 用 json 运算符 -> / ->> 与 json_typeof。
UPDATE "Execution"
SET "decision" = CASE
    WHEN ("output" -> 'metadata' ->> 'engineError') = 'true' THEN 'error'::"ExecutionDecision"
    WHEN ("output" -> 'metadata' ->> 'decision') = 'indeterminate' THEN 'indeterminate'::"ExecutionDecision"
    WHEN ("output" ->> 'allowed') = 'true' THEN 'approved'::"ExecutionDecision"
    ELSE 'denied'::"ExecutionDecision"  -- 已由 WHERE 限定含 allowed 字段，故此处必是 allowed≠true=真实拒绝
  END
WHERE "decision" IS NULL
  AND "output" IS NOT NULL
  AND json_typeof("output") = 'object'
  AND (
    -- 仅回填能明确判定的行：有引擎错误标记 / indeterminate 标记 / 有布尔 allowed 字段。
    ("output" -> 'metadata' ->> 'engineError') = 'true'
    OR ("output" -> 'metadata' ->> 'decision') = 'indeterminate'
    OR ("output" -> 'allowed') IS NOT NULL
  );
