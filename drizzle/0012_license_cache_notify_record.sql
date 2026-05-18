-- License renewal warning idempotency record.
--
-- JSON shape:
--   { "version": "signingKeyId:verifiedAtIso", "thresholds": { "14": "2026-05-18T08:00:00.000Z" } }
-- 每个 on-prem deployment 只记录自己的提醒发送历史。

ALTER TABLE "LicenseCache" ADD COLUMN IF NOT EXISTS "renewal_notify_record" jsonb NOT NULL DEFAULT '{}'::jsonb;
