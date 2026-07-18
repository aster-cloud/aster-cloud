-- P0-A S1（信任层5 transition authorization）：RegressionUpgradeManifest 表 + append-only + INSERT 守卫触发器。
--
-- mirror RegressionDriftApproval（0037 append-only + 0039 INSERT 守卫）：
--   - 表：已签名 upgrade-manifest（baseline X → current Y 被批准的有方向升级证据），FK 到 RegressionReport。
--   - append-only：BEFORE UPDATE/DELETE 只允许一次性 revoke（其余列冻结），禁 DELETE。
--   - INSERT 守卫：statement_timestamp backdate 防护 + 拒预填 revoke + expiresAt>approvedAt + 父表冗余字段
--     一致（reportHash/policyId/policyVersionRowId）+ 声明身份 SoD（approvedBy != report.createdBy）。
--
-- ★信任边界（诚实，同 0039）：这些触发器拦受限凭证的普通 INSERT，不抗 DB superuser；SoD 比较两个**声明**
--   字符串（非真实主体）——真身份 SoD 靠 2-人 ceremony（operator/witness JWT）+ 应用可信 session。
-- ★S1 不解锁签字：manifest 只证「批准了 X→Y 方向」（层5），报告携此仍 UNSIGNABLE（provenance 未验证）。

CREATE TABLE IF NOT EXISTS "RegressionUpgradeManifest" (
	"id" text PRIMARY KEY NOT NULL,
	"reportId" text NOT NULL,
	"reportHash" text NOT NULL,
	"policyId" text NOT NULL,
	"policyVersionRowId" text NOT NULL,
	"baselineToolchainId" text NOT NULL,
	"currentToolchainId" text NOT NULL,
	"canonicalPayloadB64url" text NOT NULL,
	"signature" text NOT NULL,
	"keyId" text NOT NULL,
	"keyVersion" text NOT NULL,
	"approvedBy" text NOT NULL,
	"approvedAt" timestamp DEFAULT now() NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"revokedAt" timestamp,
	"revokedBy" text,
	"manifestHash" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "RegressionUpgradeManifest_manifestHash_unique" UNIQUE("manifestHash")
);
--> statement-breakpoint
-- FK：引用不可变父报告（append-only 无 DELETE，故 ON DELETE NO ACTION）。
ALTER TABLE "RegressionUpgradeManifest"
  ADD CONSTRAINT "RegressionUpgradeManifest_reportId_RegressionReport_id_fk"
  FOREIGN KEY ("reportId") REFERENCES "public"."RegressionReport"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionUpgradeManifest_reportId_idx" ON "RegressionUpgradeManifest" ("reportId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "RegressionUpgradeManifest_policyVersionRowId_idx" ON "RegressionUpgradeManifest" ("policyVersionRowId");--> statement-breakpoint
-- 一份报告对同一 (baseline,current) transition 只允许一条有效（未撤销）manifest。
CREATE UNIQUE INDEX IF NOT EXISTS "RegressionUpgradeManifest_active_unique"
  ON "RegressionUpgradeManifest" ("reportId","baselineToolchainId","currentToolchainId")
  WHERE "revokedAt" IS NULL;
--> statement-breakpoint

-- ── append-only（BEFORE UPDATE/DELETE）：只允许一次性 revoke，其余列冻结，禁 DELETE（mirror 0037）──
CREATE OR REPLACE FUNCTION "regression_manifest_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'append-only: DELETE on RegressionUpgradeManifest is forbidden';
  END IF;
  -- UPDATE：除 revokedAt/revokedBy 外所有列必须不变。
  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."reportId" IS DISTINCT FROM OLD."reportId"
     OR NEW."reportHash" IS DISTINCT FROM OLD."reportHash"
     OR NEW."policyId" IS DISTINCT FROM OLD."policyId"
     OR NEW."policyVersionRowId" IS DISTINCT FROM OLD."policyVersionRowId"
     OR NEW."baselineToolchainId" IS DISTINCT FROM OLD."baselineToolchainId"
     OR NEW."currentToolchainId" IS DISTINCT FROM OLD."currentToolchainId"
     OR NEW."canonicalPayloadB64url" IS DISTINCT FROM OLD."canonicalPayloadB64url"
     OR NEW."signature" IS DISTINCT FROM OLD."signature"
     OR NEW."keyId" IS DISTINCT FROM OLD."keyId"
     OR NEW."keyVersion" IS DISTINCT FROM OLD."keyVersion"
     OR NEW."approvedBy" IS DISTINCT FROM OLD."approvedBy"
     OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."manifestHash" IS DISTINCT FROM OLD."manifestHash"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest is immutable except revoke (revokedAt/revokedBy)';
  END IF;
  -- ★撤销是严格一次性状态转换：OLD 两列都 NULL、NEW 两列都非 NULL，缺一不可。
  IF OLD."revokedAt" IS NOT NULL OR OLD."revokedBy" IS NOT NULL THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest already revoked; revoke is one-shot';
  END IF;
  IF NEW."revokedAt" IS NULL OR NEW."revokedBy" IS NULL THEN
    RAISE EXCEPTION 'revoke requires both revokedAt and revokedBy to be set (NULL->NOT NULL)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionUpgradeManifest_guard" ON "RegressionUpgradeManifest";--> statement-breakpoint
CREATE TRIGGER "RegressionUpgradeManifest_guard"
  BEFORE UPDATE OR DELETE ON "RegressionUpgradeManifest"
  FOR EACH ROW EXECUTE FUNCTION "regression_manifest_guard"();
--> statement-breakpoint

-- ── INSERT 守卫（BEFORE INSERT，任何路径含直连都跑）：backdate 防护 + 父一致性 + 声明身份 SoD（mirror 0039）──
CREATE OR REPLACE FUNCTION "regression_manifest_insert_guard"() RETURNS trigger AS $$
DECLARE
  v_creator     text;
  v_report_hash text;
  v_policy_id   text;
  v_pv_row_id   text;
BEGIN
  -- backdate 防护：强制服务器语句时间（无视 insert 提供值）。
  NEW."approvedAt" := statement_timestamp();
  NEW."createdAt"  := statement_timestamp();

  -- 初始状态：INSERT 时不得预填撤销列（撤销是后续一次性 UPDATE）。
  IF NEW."revokedAt" IS NOT NULL OR NEW."revokedBy" IS NOT NULL THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest must be inserted un-revoked (revokedAt/revokedBy must be NULL)';
  END IF;

  -- 时间关系：有效期须晚于批准时刻（防生效即过期/时间倒置）。
  IF NEW."expiresAt" <= NEW."approvedAt" THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest expiresAt must be after approvedAt';
  END IF;

  -- 方向性：升级必须有方向（baseline != current；同签名端 signing-api 强制）。
  IF NEW."baselineToolchainId" = NEW."currentToolchainId" THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest baselineToolchainId must differ from currentToolchainId (no directional upgrade otherwise)';
  END IF;

  -- 查父 report（FK 已保证存在，trigger 内查以取 createdBy + 校验冗余字段一致）。
  SELECT "createdBy", "reportHash", "policyId", "policyVersionRowId"
    INTO v_creator, v_report_hash, v_policy_id, v_pv_row_id
    FROM "RegressionReport" WHERE "id" = NEW."reportId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest references missing report %', NEW."reportId";
  END IF;
  IF v_creator IS NULL THEN
    RAISE EXCEPTION 'report % has NULL createdBy; cannot enforce separation of duties', NEW."reportId";
  END IF;

  -- 父表冗余字段一致（否则 manifest 内部矛盾：reportId 指真报告但 hash/policy 指另一份）。
  IF NEW."reportHash" IS DISTINCT FROM v_report_hash THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest reportHash does not match parent report';
  END IF;
  IF NEW."policyId" IS DISTINCT FROM v_policy_id THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest policyId does not match parent report';
  END IF;
  IF NEW."policyVersionRowId" IS DISTINCT FROM v_pv_row_id THEN
    RAISE EXCEPTION 'RegressionUpgradeManifest policyVersionRowId does not match parent report';
  END IF;

  -- ★声明身份 SoD：批准人声明 != 报告创建者声明。诚实：比较两个声明字符串，非真实主体。
  IF NEW."approvedBy" = v_creator THEN
    RAISE EXCEPTION 'separation_of_duties: approvedBy equals report creator (%)', v_creator;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS "RegressionUpgradeManifest_insert_guard" ON "RegressionUpgradeManifest";--> statement-breakpoint
CREATE TRIGGER "RegressionUpgradeManifest_insert_guard"
  BEFORE INSERT ON "RegressionUpgradeManifest"
  FOR EACH ROW EXECUTE FUNCTION "regression_manifest_insert_guard"();
