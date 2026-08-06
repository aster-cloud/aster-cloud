CREATE TABLE "ExecutionOutcome" (
	"id" text PRIMARY KEY NOT NULL,
	"executionId" text NOT NULL,
	"userId" text NOT NULL,
	"policyId" text NOT NULL,
	"outcome" text NOT NULL,
	"value" numeric(20, 4),
	"occurredAt" timestamp,
	"reportedAt" timestamp DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "ExecutionOutcome_executionId_key" ON "ExecutionOutcome" USING btree ("executionId");--> statement-breakpoint
CREATE INDEX "ExecutionOutcome_userId_idx" ON "ExecutionOutcome" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "ExecutionOutcome_policyId_idx" ON "ExecutionOutcome" USING btree ("policyId");--> statement-breakpoint
CREATE INDEX "ExecutionOutcome_outcome_idx" ON "ExecutionOutcome" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "ExecutionOutcome_occurredAt_idx" ON "ExecutionOutcome" USING btree ("occurredAt");