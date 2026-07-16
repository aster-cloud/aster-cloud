-- 多 key + 优先级（BYOK 优先级 fallback）：一个用户同一 provider 可绑多个 key。
--   1) 去掉 (userId,provider) 唯一约束——同 provider 现在允许多个 key。
--   2) 加 priority（数值小=优先级高，推理层按 priority asc 取第一个可用 key）。默认 0：
--      历史单 key 行迁移后全为 0，退化为「任取唯一一个」，行为不变。
--   3) 加选择索引 (userId,provider,priority) 覆盖推理层排序谓词。
-- 全部幂等（IF EXISTS / IF NOT EXISTS），与 db-bootstrap 自愈路径一致，可重复应用。
DROP INDEX IF EXISTS "AiKey_userId_provider_idx";--> statement-breakpoint
ALTER TABLE "AiKeyBinding" ADD COLUMN IF NOT EXISTS "priority" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "AiKey_userId_provider_priority_idx" ON "AiKeyBinding" ("userId","provider","priority");
