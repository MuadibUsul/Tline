"""Offline regression checks for publication acknowledgement and retry state."""
import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

root = Path('/opt/tlines-worker')
sys.path.insert(0, str(root / 'site-monitors'))
from tlines_mcp import TlinesClient, TlinesError

client = TlinesClient('offline-test')
client._initialized = True
with patch.object(client, '_post', return_value={'result': {'isError': True, 'content': [{'type': 'text', 'text': '{"error":{"code":"SCOPE_DENIED"}}'}]}}):
    try:
        client.call('publish_news', {'id': 'draft-1'})
        raise AssertionError('Tool failure was accepted')
    except TlinesError:
        pass

args = dict(column_slug='test-desk', title_zh='研究团队发布人工智能研究进展', body_zh='【研究】研究团队称新方法改善了模型训练流程。', title_en='Researchers report a change to model training', body_en='[Research] The researchers said the method improves model training.', source_url='https://example.com/test')
with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, TLINES_WORKER_ROOT=directory):
    calls = []
    def fail_publish(name, arguments):
        calls.append(name)
        if name == 'create_news':
            return {'id': 'draft-1'}
        raise TlinesError('publish rejected')
    with patch.object(client, 'call', side_effect=fail_publish):
        try:
            client.create_and_publish_flash(**args)
            raise AssertionError('Rejected publish counted as success')
        except TlinesError:
            pass
    assert calls == ['create_news', 'publish_news']
    calls.clear()
    def retry_publish(name, arguments):
        calls.append(name)
        return {'id': 'draft-1', 'status': 'draft'}
    with patch.object(client, 'call', side_effect=retry_publish):
        assert client.create_and_publish_flash(**args) == 'draft-1'
    assert calls == ['get_news', 'update_news', 'publish_news'], calls
    ledger = json.loads((Path(directory) / 'publications.json').read_text())
    assert ledger['test-desk\nhttps://example.com/test'] == 'draft-1'
    with patch.object(client, 'call', return_value={'id': 'draft-1', 'status': 'published'}) as read:
        assert client.create_and_publish_flash(**args) == 'draft-1'
        assert read.call_count == 1

spec = importlib.util.spec_from_file_location('preprint_polisher', root / 'preprint-picks' / 'deepseek_polish.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
with patch.object(module._module, 'polish_flash', return_value={}) as delegate:
    module.polish_flash(tag='arXiv')
    delegate.assert_called_once_with(tag='arXiv', is_preprint=True)
try:
    module.assert_english('Example English headline', '')
    raise AssertionError('Missing English body accepted')
except module.DeepSeekError:
    pass
sys.path.insert(0, str(root / 'preprint-picks'))
spec = importlib.util.spec_from_file_location('arxiv_runner', root / 'preprint-picks' / 'run_arxiv.py')
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)
picks = [dict(id=str(i), title='Research finding ' + str(i), url='https://example.com/' + str(i), abstract='Research abstract', score=1) for i in (1, 2)]
flash = {name: args[key] for name, key in (('titleZh','title_zh'),('bodyZh','body_zh'),('titleEn','title_en'),('bodyEn','body_en'))}
class PartialPublisher:
    def create_and_publish_flash(self, **fields):
        assert fields['body_en'] == flash['bodyEn']
        if fields['source_url'].endswith('/2'):
            raise runner.TlinesError('rejected')
        return 'published-1'
with patch.object(runner, 'load_seen', return_value=set()), patch.object(runner, 'fetch_new_submissions', return_value=(picks, 'test')), patch.object(runner, 'pick_top', return_value=picks), patch.object(runner, 'polish_flash', return_value=flash), patch.object(runner, 'TlinesClient', PartialPublisher), patch.object(runner, 'append_seen') as seen:
    runner.run()
    assert seen.call_count == 1
    assert seen.call_args.args[1] == ['1'], seen.call_args
print('PASS: tool errors rejected; draft retry reuses id; published source reused; bilingual checks enforced; partial publication keeps failed paper unseen')
