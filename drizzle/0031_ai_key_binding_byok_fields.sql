-- BYOK 增强：AiKeyBinding 加 3 个可选字段。
--   providerUrl : 自定义 provider API base URL（null=用 aster-api 内置默认）。
--                 ⚠️ 真实 enforcement 需 aster-api 后端配套（byok-envelope 当前不带 baseUrl）——
--                 本列先做「存储 + UI 输入 + 校验」，推理层生效单独立项。
--   tokenQuota  : BYOK 月度 token 上限（prompt+completion）。null=无限（保持历史「BYOK unlimited」语义）。
--   expiresAt   : key 失效日期。过期后推理层拒用该 BYOK key。null=永不过期。
-- 全部 nullable，不破坏现有行。用 IF NOT EXISTS 保持与 db-bootstrap 自愈路径幂等一致。
ALTER TABLE "AiKeyBinding" ADD COLUMN IF NOT EXISTS "providerUrl" text;--> statement-breakpoint
ALTER TABLE "AiKeyBinding" ADD COLUMN IF NOT EXISTS "tokenQuota" integer;--> statement-breakpoint
ALTER TABLE "AiKeyBinding" ADD COLUMN IF NOT EXISTS "expiresAt" timestamp;
