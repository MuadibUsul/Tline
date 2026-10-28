#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" != "--old-worker-stopped" ]]; then
  echo 'Confirm the old Grok daemon, supervisor, child jobs and historical routines are stopped before using --old-worker-stopped.' >&2
  exit 2
fi
umask 077
sudo -n test -d /opt/tlines-worker
sudo -n test -f /home/deploy/snapshot-published.py
if systemctl is-active --quiet tlines-worker; then
  echo 'Worker is already active; refusing to repeat the cutover.' >&2
  exit 1
fi
sudo -n env TLINES_WORKER_ROOT=/opt/tlines-worker python3 /home/deploy/snapshot-published.py
sudo -n chown tlines:tlines /opt/tlines-worker/publications.json
sudo -n chmod 600 /opt/tlines-worker/publications.json
sudo -n -u tlines python3 -c 'from pathlib import Path; p=Path("/opt/tlines-worker/site-monitors"); (p/".vps-health-offset").write_text(str((p/"FAILS.jsonl").stat().st_size))'
sudo -n -u tlines env TLINES_WORKER_ROOT=/opt/tlines-worker python3 /opt/tlines-worker/verify_worker.py | tail -n 1
sudo -n -u tlines env TLINES_WORKER_ROOT=/opt/tlines-worker python3 /opt/tlines-worker/preflight.py
sudo -n systemctl enable --now tlines-worker.service tlines-worker-health.timer
sudo -n systemctl is-active tlines-worker.service tlines-worker-health.timer
sudo -n systemctl show tlines-worker -p MainPID -p NRestarts -p ActiveState
echo 'Cutover started. Verify a completed SITE_BATCH and one newly published bilingual flash before declaring success.'
