-- Item 2（legacy m1.0 签字策略）：把 RegressionCase.caseHashVersion 的 DB default 从
-- 'case-hash/m1.0' 改为 'case-hash/m1.1'。
--
-- 背景：m1.0 caseHash 公式只绑 9 字段，不含 coverageTags/baselineRuntimeToolchainId/expectedDecision
-- 等签字级 gate 字段，已被政策定义为**不可签字**弱绑定版本。应用层 freeze 一直显式写 m1.1；改 default
-- 只关闭「直接 DB 写 / 遗漏 writer」继续产生 m1.0（不可签字）行的入口。
--
-- ★既有 m1.0 行不动：0036 把历史行回填 m1.0 是不可变历史事实，本迁移**只改 default**，不 UPDATE 任何
-- 现存行（RegressionCase 为 append-only，见 0037，也禁止 UPDATE）。含 m1.0 case 的报告由 runner m1.3 的
-- signability 轴标注为 UNSIGNABLE；真迁移路径=新建 PolicyVersion 行重新 freeze（非原地重 hash）。
--
-- CHECK 约束（0036 加的 IN ('case-hash/m1.0','case-hash/m1.1')）保持不变——m1.0 仍是合法**历史**值，
-- 只是不再是新行的默认值。

ALTER TABLE "RegressionCase" ALTER COLUMN "caseHashVersion" SET DEFAULT 'case-hash/m1.1';
