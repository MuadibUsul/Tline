# site-monitors / preprint-picks VPS migration

Veynod task: `vps-migrate-2026-10-27` (claimed by Codex-2).

## Deployment scope and current state

This is the independent Python news worker, separate from the Next.js website and its Docker schedulers. It is installed at `/opt/tlines-worker` on `server1.tlines.tech` (`104.207.82.85`). User `tlines` owns the worker, state and credentials. Python 3.12.3 is installed; no pip dependencies were added.

**Running on the VPS; cutover verification incomplete (checked 2026-10-31):** `tlines-worker.service` and `tlines-worker-health.timer` are enabled and active. The service has run since 2026-10-28 15:45 UTC with `NRestarts=0`. The old Grok worker's stopped state has not been independently confirmed. Running both publishers risks duplicate posts; the shared publisher key was not revoked because other Grok jobs may use it.

The package's previous Veynod holder timed out without a continuation or recorded document changes. Package: `tlines-worker-vps-migrate-2026-10-27.zip`, blob `dc143d1b-58f4-4657-a887-ec55f5bb6d38`, SHA-256 `20fb6016d7cfe73eeeb34c97eb30d816374edd64d658ac201645d08543bb61e1`. Checksum verified both locally and on the VPS.

## Repairs made before starting

- Replace the retired `deepseek-chat` identifier with `deepseek-flash`; preserve DeepSeek-only generation, disable thinking for the existing fast polish path, cap output at 2,000 tokens. `DEEPSEEK_MODEL` can override the model before startup.
- Use the canonical `America/Indiana/Indianapolis` timezone. The server lacks the legacy alias `America/Indianapolis`; this change preserves the intended clock and daylight saving behavior.
- Treat MCP `isError` and error envelopes as failures. A failed publish must not advance seen/queue state.
- Keep a local publication ledger by column and source URL. Store a created draft's id before publishing; retries reuse that draft, while confirmed published posts are not published again. This ledger assumes the existing single sequential daemon writer. A lost response to **create_news** before its id is stored remains a residual ambiguity because the server does not expose a source idempotency key.
- Seed the ledger from production news data: 486 historical flash rows, 482 column/source identities at preparation time. Refresh immediately before starting because the source archive is from October 27. These are read-only database queries; no database schema or existing news records were changed.
- Reuse the existing bilingual DeepSeek polisher for preprints, keep preprint attribution, forward all four language fields, reject incomplete queued content and restage incomplete pending entries.
- Advance preprint seen state only for successfully published picks, preserving failed or unselected candidates for a retry.
- Retain one supervisor and one daemon under systemd. Add a 90-second stop limit, cgroup termination, restrictive umask and filesystem protections. A five-minute health timer records new failure counts and daemon heartbeat status in journald; it does not send external notifications.

The code package and `.env` files remain outside this repository. Credential files are mode `0600`; credentials are never included in this report or the deployment patch. `deploy/tlines-worker/` contains only the patch, checks and deployment support files.

## Validation completed

- Python compilation of both worker directories passed.
- Offline checks passed: business errors reject publication; failed publishes retain draft ids; retries do not create another draft; already-published sources are reused; bilingual checks reject missing English; partial arXiv publication marks only the successful paper seen.
- Production MCP authentication succeeded; all required columns exist (37 columns returned, 30 live site sources).
- DeepSeek authentication and the current model list succeeded.
- One actual Anthropic source item was fetched and polished through DeepSeek into `titleZh`, `bodyZh`, `titleEn`, `bodyEn`, passing language validation. It was **not published**.
- Anthropic dry run fetched 62 candidates. HF Papers dry run fetched 40 candidates. Both used the real source fetch paths and performed no publishing.
- `systemd-analyze verify` passed for the worker and health units.

## VPS state checked 2026-10-31

- At the check, local `main` and GitHub `main` matched at `445028e9b55798e62bae2e9cb5d0a516e1b3243e`, which includes the migration preparation commit `3289696`; this status update was subsequently pushed to both. The seven tracked deployment support files match their installed VPS copies byte for byte by SHA-256. The tracked `worker-fixes.patch` passes `git apply --reverse --check` against `/opt/tlines-worker`, confirming that the patch is present in the deployed worker. No worker Python file had a modification time after 2026-10-28. The original worker package is outside Git, and the VPS directory is not a Git checkout, so these checks do not establish complete source provenance for that package.
- At 2026-10-31 06:56 UTC, the worker and health timer were enabled and active; `MainPID=1575430` and `NRestarts=0`. The health check reported `worker_active=true`, a fresh heartbeat and zero new failure entries. The latest completed site batch visible in `daemon.log` was 2026-10-30 23:45 China time: 30 sources, one failure, followed by `SITE_BATCH done`.
- These observations establish that the VPS publisher is running. They do not confirm that the old Grok publisher stopped, that a new bilingual item was published, or that a repeated source URL was deduplicated. The Veynod task remained `WAITING_HUMAN` at this check and has not been handed to `REVIEWING`.

## Remaining verification

1. On the old Grok machine, confirm its daemon, supervisor, publishing children and historical routines are stopped. If any remain active, stop them with the old `site-monitors/daemon_ctl.sh stop` procedure and verify again. The current session has VPS access but no connection to that Grok machine.
2. Check whether the latest seen files, morning state and preprint queue were transferred after the old worker stopped. If this step was missed, compare state with the running VPS worker before changing anything; do not overwrite patched Python files, live state or credentials with the old package. The production-backed ledger is an additional duplicate guard, not proof that the old machine is stopped.
3. The VPS worker is already active. Do not rerun `/home/deploy/tlines-worker-cutover.sh`; it refuses an active worker. Confirm how the old-to-new cutover was performed before treating it as complete.
4. Verify one supervisor and one daemon, a completed `SITE_BATCH`, at least one newly published bilingual news item, and that a repeated source URL within a worker column appears only once. Investigate the one failed source in the last observed batch. Do not report a successful cutover based solely on systemd being active.
5. Hand the Veynod task to `REVIEWING` with these production results; the executor must not mark its own task `DONE`.

## Operations and rollback

Inspect `systemctl status tlines-worker`, `journalctl -u tlines-worker-health`, `/opt/tlines-worker/site-monitors/daemon.log` and `FAILS.jsonl`. The daemon still uses its existing source schedules and local `/tmp` locks. Its captured batch output is emitted after a batch finishes, so a long source run can delay the visible batch summary.

To roll back after cutover, stop and disable `tlines-worker.service` and `tlines-worker-health.timer` first. Verify the systemd cgroup has no live publisher children. Synchronize VPS seen, queue and morning state back to the old machine before restarting it. Retain the deployed code and publication ledger for diagnosis; do not delete production news or shared Docker volumes.

The website image and the local newsroom layout commits are outside this task's deployment scope and were not redeployed by this migration.
