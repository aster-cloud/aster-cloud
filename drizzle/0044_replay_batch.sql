-- ADR 0034：What-If 重做——异步 ReplayBatch（S1 建表）
--
-- 背景：上一版（Phase 4）用同步按需重跑 + **部分成功估算**，因选择偏差在五轮
-- 交叉审查后被撤下：允许「200 条发起、30 条成功」就对这 30 条出完整业务数字，
-- 而重跑失败与输入/词汇/策略路径**相关**——剩下的成功样本不是随机子集，
-- 据此算出的数字可能方向对而幅度全错。这不是加 caveat 能解决的。
--
-- 本表承载的第一性约束（§1.1）：
--   「任何被呈现的数字，其样本必须是**某个用户能理解的总体的全量**，
--     而非该总体的成功子集。」
--
-- ★为什么表在 cloud 而不是 api（§3.0）：executions 表属于本仓。
--   「数据在哪，编排就在哪」——不为一个功能新建 api→cloud 反向 HMAC 通道，
--   也不引入跨库索引一致性问题。aster-api 只负责它本来就会的「重跑一条」。

CREATE TYPE "ReplayBatchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'EXPIRED');
CREATE TYPE "ReplayWindowKind" AS ENUM ('LAST_MONTH', 'LAST_QUARTER', 'LAST_HALF_YEAR', 'LAST_YEAR', 'CUSTOM');

CREATE TABLE "ReplayBatch" (
    "id"                  TEXT PRIMARY KEY NOT NULL,

    "userId"              TEXT NOT NULL,
    "policyId"            TEXT NOT NULL,
    "baseVersionRowId"    TEXT NOT NULL,
    "targetVersionRowId"  TEXT NOT NULL,

    -- 窗口是**显式口径**，不是隐形抽样；windowLabel 必须与数字同屏呈现
    "windowKind"          "ReplayWindowKind" NOT NULL,
    "windowLabel"         TEXT NOT NULL,
    "windowTimezone"      TEXT NOT NULL DEFAULT 'UTC',
    -- 创建时固化的绝对时刻，左闭右开；右边界取当天 00:00（不含当天）
    "windowFrom"          TIMESTAMP NOT NULL,
    "windowTo"            TIMESTAMP NOT NULL,

    "plannedCount"        INTEGER NOT NULL,
    "completedCount"      INTEGER NOT NULL DEFAULT 0,
    "failedCount"         INTEGER NOT NULL DEFAULT 0,

    "status"              "ReplayBatchStatus" NOT NULL DEFAULT 'PENDING',

    "failureReasons"      JSONB,
    "resultSummary"       JSONB,
    "toolchainId"         TEXT,

    "createdAt"           TIMESTAMP NOT NULL DEFAULT NOW(),
    "startedAt"           TIMESTAMP,
    "finishedAt"          TIMESTAMP,
    "expiresAt"           TIMESTAMP NOT NULL,

    CONSTRAINT "ReplayBatch_window_ck" CHECK ("windowFrom" < "windowTo"),

    CONSTRAINT "ReplayBatch_counts_ck" CHECK (
        "plannedCount"   >= 0 AND
        "completedCount" >= 0 AND
        "failedCount"    >= 0 AND
        "completedCount" + "failedCount" <= "plannedCount"
    ),

    -- ★第一性约束的 DB 兜底之一：只有 COMPLETED 才允许携带数字。
    --   应用层再怎么写错，FAILED/EXPIRED 批次也拿不出 resultSummary。
    CONSTRAINT "ReplayBatch_result_only_when_completed_ck" CHECK (
        ("status" = 'COMPLETED' AND "resultSummary" IS NOT NULL)
        OR ("status" <> 'COMPLETED' AND "resultSummary" IS NULL)
    ),

    -- ★第一性约束的 DB 兜底之二：COMPLETED 必须是**全量成功**。
    --   一条失败、或没跑满 planned，都不允许标记为完成。
    CONSTRAINT "ReplayBatch_completed_is_total_ck" CHECK (
        "status" <> 'COMPLETED'
        OR ("failedCount" = 0 AND "completedCount" = "plannedCount")
    )
);

-- 并发上限判定（§7.2）：查本用户当前有几个活跃批次。
-- 部分索引只覆盖活跃状态，历史批次不占索引。
CREATE INDEX "ReplayBatch_active_by_user_idx"
    ON "ReplayBatch" ("userId")
    WHERE "status" IN ('PENDING', 'RUNNING');

CREATE INDEX "ReplayBatch_policy_createdAt_idx"
    ON "ReplayBatch" ("policyId", "createdAt");

CREATE INDEX "ReplayBatch_expiresAt_idx"
    ON "ReplayBatch" ("expiresAt")
    WHERE "status" IN ('COMPLETED', 'FAILED');

COMMENT ON TABLE "ReplayBatch" IS
    'What-If 影响估算的批次账本（ADR 0034）。窗口内全量重跑、全部成功才出数字；'
    '任一条失败即整批拒答。只存元数据与聚合结果，不存逐条 targetDecision。';

COMMENT ON COLUMN "ReplayBatch"."windowTo" IS
    '窗口终点（不含）。取当天 00:00——边界指向已封闭的过去，正在写入的数据天然在窗口外。';

COMMENT ON COLUMN "ReplayBatch"."resultSummary" IS
    '聚合结果。仅 COMPLETED 时非空，由 CHECK 约束强制——拒答的批次在数据库层就拿不出数字。';
