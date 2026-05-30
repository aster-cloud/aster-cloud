# Domain Vocabulary — Chaos Runbook (B15)

Targeted failure scenarios for the user-domain-vocabulary feature. Run these
in staging before every major release of the feature, after dependency
upgrades (Drizzle, Postgres, Workers runtime), or whenever the SSE / cron
infrastructure changes.

The scenarios assume the staging cluster is reachable on
`https://staging.aster-lang.cloud` and you have:
- An admin session cookie for SSE / metrics inspection
- A Pro-plan test user with a session cookie
- The cron secret (`CRON_SECRET`) for triggering the worker manually
- Postgres superuser access for transactional failure injection

## Scenario 1: kill a bulk worker mid-chunk

Goal: confirm the stale-recovery sweep + per-tick `queued → running →
queued` transitions let the next worker tick resume the same job without
losing progress or double-applying rows.

Steps:
1. Enqueue a 5,000-row async bulk via the UI (or k6 `asyncEnqueue` scenario).
2. Trigger the worker manually with `?maxJobs=1`:
   ```
   curl -X POST \
     -H "Authorization: Bearer $CRON_SECRET" \
     "https://staging.aster-lang.cloud/api/cron/domain-vocabulary-bulk-worker?maxJobs=1"
   ```
3. Immediately mark the job back to `running` in Postgres while the chunk
   is still committing (use `pg_sleep` in another session to simulate a
   process pause). Verify the row stays in `running`.
4. Wait 5 minutes (or set `STALE_RUNNING_AGE_MS` lower in the worker for
   the test) and confirm stale recovery flips it back to `queued`.
5. Trigger the worker again — it should pick up from `processed` rather
   than restarting from 0.

Pass criteria:
- Final `rollup.added + rollup.reused == 5000 - rollup.skipped`
- No duplicate `UserDomainTerm` rows for the user
- No `quota_exceeded` errors unless the user genuinely hit their plan cap

## Scenario 2: idempotency replay storm

Goal: confirm that a retrying client cannot double-execute the same
mutation even under high concurrency.

Steps:
1. Pick a stable `Idempotency-Key`, e.g. `chaos-replay-001`.
2. Fire 50 concurrent `POST /api/v1/domain-vocabularies/terms` with the
   same key and identical body via xargs/curl or k6.
3. Inspect `LexiconIdempotencyKey` — there must be exactly **one** row for
   the (userId, routeKey, key) tuple.
4. Verify the user has exactly one new active link, not 50.
5. Repeat with a different body but the same key — expect HTTP 409
   `idempotency_key_conflict`.

Pass criteria:
- 49 of 50 requests replay the cached response (`replayed: true` in body)
- No `duplicate_link` errors from the user perspective
- DB row count for `UserDomainTerm` increases by exactly 1

## Scenario 3: rollback while SSE clients are connected

Goal: confirm that an active editor session refetches the new vocabulary
after a rollback and that the Monaco re-registration does not corrupt the
client cache.

Steps:
1. Open the policy editor in two browser tabs as the same user.
2. From a third tab (or via curl) call
   `POST /api/v1/domain-vocabularies/snapshots/:id/rollback` with a known
   snapshot id.
3. Verify both editor tabs receive the SSE `invalidate` event within 2s
   (DevTools → Network → EventSource).
4. Trigger Monaco autocompletion in each tab and verify the term list
   matches the rolled-back state (not the pre-rollback state).
5. Disconnect one tab's network for 30s, then reconnect — the EventSource
   must reconnect and replay catches up via the `id:` line each invalidate
   event ships (browsers replay it as the `Last-Event-ID` header). v1 IDs
   are per-process and let the client deduplicate; full cross-pod replay
   needs the v2 Redis-backed event store.

Pass criteria:
- Both SSE clients receive at most one `invalidate` event for the same
  rollback (no event duplication)
- Reconnect after network loss recovers cleanly within 30s
- No 500s in `aster_lexicon_op_total{op="snapshot.rollback",status="error"}`

## Scenario 4: quota race under concurrent add + bulk

Goal: confirm the per-user advisory lock prevents quota overshoot.

Steps:
1. Set the test user's `customLexiconMaxTerms` to 100 via plan override.
2. Pre-fill the user with 95 active links.
3. Concurrently issue:
   - 1 × `POST /bulk` with 20 rows
   - 50 × `POST /terms` with single rows
4. Wait for all responses.

Pass criteria:
- The user has exactly 100 active links (the cap is honoured)
- 15 of the bulk rows complete; 5 report `quota_exceeded`
- 50 single-add responses split into successes (up to remaining headroom)
  and `quota_exceeded` 422s

## Scenario 5: snapshot creation failure during publish

Goal: confirm that policy approval is not blocked by a snapshot IO failure
(degraded mode is OK; loud logging is required).

Steps:
1. Drop the unique index on `UserVocabularySnapshot` (staging only):
   ```
   DROP INDEX IF EXISTS "UserVocabularySnapshot_owner_hash_unique";
   ```
2. Approve a draft policy version via the normal flow.
3. Confirm the policy version moves to `APPROVED`.
4. Confirm `policyVersions.vocabularySnapshotIds` is `[]`.
5. Confirm a `[vocabulary-snapshot] failed (non-blocking)` line appears in
   the application logs with the underlying error.
6. Recreate the index and re-trigger the approval workflow — confirm
   subsequent approvals get a non-empty snapshot list.

Pass criteria:
- Approval is not blocked by snapshot failure
- The failure is surfaced in logs (not silently dropped)
- Recovery after the index is restored is automatic

## Scenario 6: DSAR hard delete

Goal: confirm `purgeUserVocabulary` removes all owner-scoped rows even when
the `UserVocabularySnapshot` table is large.

Steps:
1. Pre-fill the test user with ~1k active links + ~100 snapshots.
2. Run `purgeUserVocabulary` via a test-only route, then `DELETE` the user
   row.
3. Inspect each lexicon table for residual rows owned by the user id.

Pass criteria:
- 0 rows remain in any lexicon-* table referencing the userId
- Cascade FKs handle the easy cases; explicit purge handles snapshots
- No FK violations in the `DELETE FROM "User"` statement
