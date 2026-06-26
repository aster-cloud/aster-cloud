-- ADR 0022 方案 D：用户自定义关键词别名的版本固化（cloud 侧 aster_cloud 库）。
--
-- 生产策略创建走 cloud BFF（POST /api/policies，drizzle 直插 PolicyVersion），故方案 D 的
-- 别名快照 + envelope 列加在本库（aster_cloud.PolicyVersion，camelCase 命名）。这与 aster-api
-- 的 Flyway V6.14.0（aster_api.policy_versions，snake_case）是**两个独立库的独立表**——经实证
-- （aster_api 与 aster_cloud 是 shared-postgres 上两个 database），不共享物理表，无数据分裂风险。
--
-- aliasSet：版本编译时冻结的规范别名 JSON（kind→[别名,...]），NULL=无别名。不可变。
-- sourceEnvelopeSha256：覆盖完整编译输入（content+aliasSet+locale+工具链）的 SHA-256，防别名替换篡改。
--   算法与 Java 侧逐字节一致（src/lib/policy-alias.ts，parity 由 policy-alias.test.ts 钉住）。
-- sourceToolchainId：envelope 计算所用工具链身份，供 tip-anchor verifier 重算验证。

-- 幂等：与 0021-0024 同款 IF NOT EXISTS。生产 DB 可能在追踪表记录前已 push/手动施加本列
-- （__drizzle_migrations 漂移），裸 ADD COLUMN 重跑会撞 42701 致 migrate Job 失败。
ALTER TABLE "PolicyVersion" ADD COLUMN IF NOT EXISTS "aliasSet" text;
ALTER TABLE "PolicyVersion" ADD COLUMN IF NOT EXISTS "sourceEnvelopeSha256" text;
ALTER TABLE "PolicyVersion" ADD COLUMN IF NOT EXISTS "sourceToolchainId" text;
