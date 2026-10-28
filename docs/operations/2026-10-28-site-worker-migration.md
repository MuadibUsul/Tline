# site-monitors / preprint-picks VPS migration

Veynod task: `vps-migrate-2026-10-27` (claimed by Codex-2).

## Deployment scope and current state

This is the independent Python news worker, separate from the Next.js website and its Docker schedulers. It is installed at `/opt/tlines-worker` on `server1.tlines.tech` (`104.207.82.85`). User `tlines` owns the worker, state and credentials. Python 3.12.3 is installed; no pip dependencies were added.

**Prepared, not cut over:** `tlines-worker.service` and `tlines-worker-health.timer` are installed but disabled and inactive. The old Grok worker's stopped state has not been confirmed. Starting both publishers risks duplicate posts; the shared publisher key was not revoked because other Grok jobs may use it.

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

## Remaining cutover

1. On the old Grok machine, stop `/cursor/stores/store-20f6c9cc-4c95-490b-baf3-e8fd36cc0435/site-monitors/daemon_ctl.sh` with its `stop` command. Confirm no supervisor, daemon, `run_batch.py`, `run_site.py` or preprint publishing child remains; pause any old per-site/morning routines. The current session has VPS access but no connection to that Grok machine.
2. If available, transfer the latest seen files, morning state and preprint queue **after stopping** the old worker. Do not overwrite patched Python files or credentials with the old package. The production-backed ledger is an additional duplicate guard, not proof that the old machine is stopped.
3. From the VPS deploy account: `bash /home/deploy/tlines-worker-cutover.sh --old-worker-stopped`. Use the flag only once the old side's stopped state is established. The script refreshes the DB-backed ledger, runs checks and enables the worker and health timer.
4. Verify one supervisor and one daemon, `NRestarts=0`, fresh heartbeat, `SITE_BATCH begin` followed by `SITE_BATCH done`, and at least one newly published bilingual news item. Check that a repeated source URL within a worker column appears only once. Do not report a successful cutover based solely on systemd being active.
5. Hand the Veynod task to `REVIEWING` with these production results; the executor must not mark its own task `DONE`.

## Operations and rollback

Inspect `systemctl status tlines-worker`, `journalctl -u tlines-worker-health`, `/opt/tlines-worker/site-monitors/daemon.log` and `FAILS.jsonl`. The daemon still uses its existing source schedules and local `/tmp` locks. Its captured batch output is emitted after a batch finishes, so a long source run can delay the visible batch summary.

To roll back after cutover, stop and disable `tlines-worker.service` and `tlines-worker-health.timer` first. Verify the systemd cgroup has no live publisher children. Synchronize VPS seen, queue and morning state back to the old machine before restarting it. Retain the deployed code and publication ledger for diagnosis; do not delete production news or shared Docker volumes.

The website image and the local newsroom layout commits are outside this task's deployment scope and were not redeployed by this migration.
