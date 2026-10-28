"""Report new failure-ledger entries to journald without exposing item contents."""
import json
import subprocess
import time
from pathlib import Path

root = Path('/opt/tlines-worker/site-monitors')
active = subprocess.run(['systemctl', 'is-active', '--quiet', 'tlines-worker']).returncode == 0
heartbeat = root / 'daemon.heartbeat'
age = time.time() - heartbeat.stat().st_mtime if heartbeat.exists() else None
fails = root / 'FAILS.jsonl'
offset_file = root / '.vps-health-offset'
size = fails.stat().st_size if fails.exists() else 0
offset = int(offset_file.read_text()) if offset_file.exists() else size
if offset > size:
    offset = 0
lines = 0
if size > offset:
    with fails.open('rb') as stream:
        stream.seek(offset)
        lines = sum(1 for _ in stream)
offset_file.write_text(str(size))
status = {'worker_active': active, 'heartbeat_age_seconds': round(age) if age is not None else None, 'new_failure_entries': lines}
print(json.dumps(status))
raise SystemExit(0 if active and age is not None and age < 11700 and lines == 0 else 1)
