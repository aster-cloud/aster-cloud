-- BYOK「重置额度」水位线：User 加 byokQuotaResetAt（nullable timestamp）。
--   「已用额度」是 byokTokensUsedThisMonth 对不可变 aiUsageRecords 的每用户聚合 SUM
--   （该表无 provider/binding 列 → 无法 per-key）。用户点「重置额度」时**不删审计记录**
--   （加密 prompt / 计费 / 180 天留存），而是把本列盖成 now()——此后统计只算
--   createdAt >= max(当月初, byokQuotaResetAt) 的行，等价「清空本月已用」而不毁账。
--   null=从未重置（按自然月初起算）。nullable，不破坏现有行；IF NOT EXISTS 与 db-bootstrap 自愈幂等。
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "byokQuotaResetAt" timestamp;
