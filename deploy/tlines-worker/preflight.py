"""Read-only deployment checks; never print credentials or publish an item."""
import json
import os
import sys
from pathlib import Path
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo

root = Path('/opt/tlines-worker')
os.environ['TLINES_WORKER_ROOT'] = str(root)
sys.path.insert(0, str(root / 'site-monitors'))
from daemon import load_dotenv
from run_site import SOURCES
from tlines_mcp import TlinesClient

load_dotenv()
assert all(os.environ.get(k) for k in ('DEEPSEEK_API_KEY', 'TLINES_MCP_KEY'))
for zone in ('Asia/Shanghai', 'America/Indiana/Indianapolis'):
    ZoneInfo(zone)
client = TlinesClient()
columns = client.call('list_news_columns')['columns']
available = {c['slug'] for c in columns}
required = {c['column'] for c in SOURCES.values() if c.get('status') == 'live'}
required.update(('arxiv-daily-picks', 'biorxiv-daily-picks', 'medrxiv-daily-picks', 'techrxiv-daily-picks', 'hf-papers-daily-picks'))
print(json.dumps({'publisher_auth': True, 'live_sources': sum(c.get('status') == 'live' for c in SOURCES.values()), 'columns': len(columns), 'missing_columns': sorted(required - available)}))
req = Request('https://api.deepseek.com/models', headers={'Authorization': 'Bearer ' + os.environ['DEEPSEEK_API_KEY']})
with urlopen(req, timeout=30) as response:
    result = json.load(response)
assert any(model['id'] == 'deepseek-flash' for model in result['data'])
print('deepseek_auth: OK; no generation or publication performed')
