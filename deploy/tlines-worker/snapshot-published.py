"""Seed migration retry ledger from the production DB; all DB operations are reads."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

root = Path('/opt/tlines-worker')
sys.path.insert(0, str(root / 'site-monitors'))
from daemon import load_dotenv
from run_site import SOURCES
load_dotenv()
def query(sql):
    result = subprocess.run(['docker', 'exec', '-i', 'tline-db-1', 'sh', '-c', 'exec psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'], input=sql, text=True, capture_output=True, check=True)
    return json.loads(result.stdout.strip())

digest = hashlib.sha256(os.environ['TLINES_MCP_KEY'].encode()).hexdigest()
metadata = query('SELECT row_to_json(k) FROM (SELECT id,name,scopes,"lastUsedAt","requestCount","revokedAt" FROM "ApiKey" WHERE "tokenHash"=\'' + digest + '\') k;')
print(json.dumps({'publisher_key_metadata': metadata}))
rows = query('''SELECT coalesce(json_agg(row_to_json(q)), '[]'::json) FROM
 (SELECT n.id,c.slug AS "column",n."sourceUrl" AS url,n.status,n."publishedAt"
 FROM "NewsPost" n JOIN "NewsColumn" c ON c.id=n."columnId"
 WHERE n.kind='flash' AND n.status IN ('draft','published') AND n."sourceUrl" IS NOT NULL
 ORDER BY n.status DESC,n."createdAt" ASC) q;''')
columns = {c['column'] for c in SOURCES.values() if c.get('status') == 'live'}
columns.update(('arxiv-daily-picks','biorxiv-daily-picks','medrxiv-daily-picks','techrxiv-daily-picks','hf-papers-daily-picks'))
path = root / 'publications.json'
ledger = json.loads(path.read_text()) if path.exists() else {}
for row in rows:
    if row['column'] in columns:
        ledger[row['column'] + '\n' + row['url']] = row['id']
staged = path.with_suffix('.tmp')
staged.write_text(json.dumps(ledger, ensure_ascii=False), encoding='utf-8')
staged.replace(path)
print(json.dumps({'historical_flash_rows': len(rows), 'ledger_entries': len(ledger), 'latest_published': max((r['publishedAt'] for r in rows if r['publishedAt']), default=None)}))
