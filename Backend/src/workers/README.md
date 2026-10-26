# Shared background worker

`npm run worker` starts `src/workers/index.js`. The existing Fly `worker` process group
uses this entrypoint, so video indexing and quiz expiration run on the same Machine.
`npm run dev:worker` enables restart on changes; `npm run dev:all` runs API and worker.
The compatibility command `npm run worker:video-indexing` intentionally runs only video indexing.

## Structure

- `index.js`: process lifecycle, signals, shared database pool cleanup.
- `config.js`: defaults and validation of optional worker environment variables.
- `registry.js`: enabled jobs, lazy loading and per-job state.
- `runLoop.js`: one serial loop per job, scheduling, retries, independent error logging.
- Domain modules: actual database claiming and business logic.

Add a registry entry with `name`, `enabled`, `intervalMs`, `retryDelayMs`, and
`async run({signal})`. Keep the work bounded and honor cancellation. Return
`{runAgainImmediately:true}` for queue consumers with more work; this still yields
to the event loop. Each run must finish before the same job runs again. Jobs share
the Node.js process, so CPU-heavy synchronous work will still block other jobs.

All enabled loops start immediately and run concurrently. Video indexing processes
one claimed job at a time; while idle it waits 2 seconds. Quiz expiration processes
one batch then waits its configured interval (30 seconds by default). Errors retry
after 5 seconds. A long HTTP call or failure in video indexing does not stop expiration.
Missing `OPENAI_API_KEY` is logged/retried only for video indexing, before claiming jobs.
Disabled jobs are not imported. Existing video queue leases/retries are unchanged.

## Optional environment variables

No new environment variables are required. Missing or blank values use these defaults:

| Variable | Default | Allowed values |
| --- | --- | --- |
| `WORKER_VIDEO_INDEXING_ENABLED` | `true` | `true` / `false` |
| `WORKER_QUIZ_EXPIRATION_ENABLED` | `true` | `true` / `false` |
| `WORKER_QUIZ_EXPIRATION_INTERVAL_MS` | `30000` | Integer 1–2147483647 |
| `WORKER_QUIZ_EXPIRATION_BATCH_SIZE` | `250` | Integer 1–1000 |

Invalid explicit values fail startup with the variable name; they do not silently
change polling behavior. Existing `DATABASE_URL` and enabled jobs' credentials are
still needed. `.env` is loaded locally; Fly uses the app's configured environment/secrets.
No new Fly process group or Machine is created by this change.

## Quiz expiration

The domain worker is `quizzes-engine/quiz-attempts/workers/expireAttempts.js`.
It selects `in_progress` attempts with non-null `expires_at <=` database time.
A partial index on `(expires_at,id)` supports this scan. Apply migrations before deployment.

Each batch runs in a transaction and claims at most 250 rows by default with
`FOR UPDATE SKIP LOCKED`. Other worker instances, answer writes and submission
cannot simultaneously finalize the same attempt. Each attempt is rechecked under
its row lock. Already finished or unexpired attempts are left unchanged.

`services/finalizeAttempt.js` calls `services/attemptResults.js`, which is also used
by manual submission. Both first grade complete unchecked saved answers through
`gradePendingAnswers()`, then reuse `getAttemptSubmissionSummary()` and saved grades:

- Sum `awarded_points` only for checked answers; unanswered/unchecked answers count as zero.
- Sum `max_points` from attempt question snapshots.
- Calculate score percentage and `passed` using `settings_snapshot.passing_score_percentage`.
- Persist `status=timed_out`, `finished_at=expires_at` and the results.
- For passed attempts, issue a certificate when the current `quizzes.certificate_template_id` selects an existing template. Certificate selection and quiz metadata use the live quiz, not attempt settings; grading still uses saved settings. The shared certificate service freezes user/quiz/result/template data and prevents duplicate issuance, including for revoked certificates.
- Ignore minimum answered/correct submission thresholds on expiration.
- Preserve question snapshots, answer content, save timestamps and all previously checked grades.
- Grade complete pending answers using snapshot settings; partial/empty drafts remain unchecked with zero contribution.
- Persist the new grades, final result and any issued certificate atomically; failures roll them back together, including the certificate number counter increment.

The service requires a caller-owned transaction and is idempotent. It returns the
finalized ID or null when no transition is needed. It does not expose internal scores
through a new API: existing response projections/feedback settings continue to govern visibility.

Invalid historical settings/grades are logged with the attempt ID and left unchanged.
A savepoint isolates these errors so healthy attempts in the batch still finalize.
A cursor rotates through full batches, preserving timestamp microseconds, so invalid
rows cannot monopolize every batch. It resets after a short/empty batch, revisiting
skipped locks and failed records. Unexpected database errors roll back the whole batch
and retry without advancing the cursor. Cursor state is in memory; restarting safely
begins scanning from the oldest expired attempt again.

API writes still reject expired attempts immediately, without waiting for the worker.
Between expiry and the worker commit, start may return `ATTEMPT_FINALIZATION_PENDING`;
after finalization it can create another attempt if the existing requirements and
`max_attempts` permit it. `timed_out` attempts continue to count toward that limit.
Large backlogs can require multiple polling cycles. The worker does not finalize
attempts during GET/PUT/POST API requests.

## Shutdown and verification

SIGTERM/SIGINT abort all loops and interrupt timer waits. Active tasks must settle
before shared pools close. Quiz expiration checks cancellation between attempts and
before commit; cancellation rolls back the current batch and releases its locks.
Its SQL statements have a local 10-second timeout and 2-second lock timeout.

`npm run test:workers` checks configuration, independent loops, retries, cancellation,
and PostgreSQL expiration/concurrency/rollback. Set `TEST_DATABASE_URL` to an isolated
test database to run the database suite; without it those tests are skipped.
