import io
import stat
import zipfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from src.api import main
from src.config.settings import settings
from src.engine.nodes import crawl_site_node
from src.engine.preserved_site import generate_preserved_site
from src.engine.source_zip import inspect_static_archive, website_members
from src.engine.source_assets import resolve_url


def archive_bytes(files):
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    return stream.getvalue()


def test_nested_zip_preserves_routes_assets_and_module_paths(tmp_path):
    path = tmp_path / 'website.zip'
    path.write_bytes(archive_bytes({
        'website/index.html': '<html><head><link rel="stylesheet" href="css/site.css?v=1"></head><body><h1>Home</h1><a href="about/?ref=home">About</a><img src="images/my photo.png"><script type="module" src="js/main.js"></script></body></html>',
        'website/about/index.html': '<html><body><h1>About</h1><a href="../index.html">Home</a></body></html>',
        'website/css/site.css': '@import "theme.css"; body { background: url("../images/my photo.png"); }',
        'website/css/theme.css': 'body { color: red; }',
        'website/js/main.js': 'import { title } from "./title.js"; document.title = title;',
        'website/js/title.js': 'export const title = "Working modules";',
        'website/images/my photo.png': b'picture',
        'website/.env': 'SECRET=not-for-export',
        '__MACOSX/website/._index.html': 'metadata',
    }))
    assert inspect_static_archive(path) == {'pages': 2, 'assets': 5}
    with patch('src.engine.nodes.tempfile.gettempdir', return_value=str(tmp_path)):
        state = crawl_site_node({'job_id': 'zip-paths', 'input_url': str(path), 'crawl_enforce_static_source': True, 'errors': []})
    assert state['status'] == 'crawled', state.get('errors')
    assert set(state['crawled_page_map']) == {'zip://index.html', 'zip://about/index.html'}
    state['schema_proposal'] = {'entities': []}
    artifacts = generate_preserved_site(state)
    assert artifacts['source_report']['routes'] == ['/', '/about/']
    assert artifacts['source_report']['missing_assets'] == []
    seed_file = next(file for file in artifacts['backend']['files'] if file['filename'] == 'seed-data.json')
    import json
    seed = json.loads(seed_file['code'])
    assert 'href="/about/?ref=home"' in seed['pages'][0]['html']
    assert 'src="/images/my%20photo.png"' in seed['pages'][0]['html']
    assets = {item['filename']: item for item in artifacts['source_assets']}
    assert 'public/images/my photo.png' in assets
    assert 'url("/images/my%20photo.png")' in assets['public/css/site.css']['code']
    assert Path(assets['public/js/main.js']['source']).read_text().startswith('import { title } from "./title.js"')
    assert resolve_url('zip://about/index.html', '../images/my%20photo.png') == 'zip://images/my%20photo.png'


def test_zip_retains_declared_legacy_html_and_css_encoding(tmp_path):
    path = tmp_path / 'legacy.zip'
    path.write_bytes(archive_bytes({
        'index.html': b'<html><head><meta charset="windows-1252"><link rel="stylesheet" href="site.css"></head><body><h1>Fran\xe7ois</h1></body></html>',
        'site.css': b'@charset "windows-1252"; body::after { content: "caf\xe9"; }',
    }))
    assert inspect_static_archive(path) == {'pages': 1, 'assets': 1}
    with patch('src.engine.nodes.tempfile.gettempdir', return_value=str(tmp_path)):
        state = crawl_site_node({'job_id': 'zip-encoding', 'input_url': str(path), 'crawl_enforce_static_source': True, 'errors': []})
    assert 'Fran\u00e7ois' in state['crawled_page_map']['zip://index.html']
    state['schema_proposal'] = {'entities': []}
    artifacts = generate_preserved_site(state)
    css = next(item['code'] for item in artifacts['source_assets'] if item['filename'] == 'public/site.css')
    assert 'caf\u00e9' in css
    assert css.startswith('@charset "UTF-8";')


def test_utf16_server_template_cannot_bypass_archive_validation(tmp_path):
    path = tmp_path / 'template.zip'
    path.write_bytes(archive_bytes({'index.html': '<html><?php echo 1; ?></html>'.encode('utf-16')}))
    with pytest.raises(ValueError, match='template tags'):
        inspect_static_archive(path)


@pytest.mark.parametrize('files, message', [
    ({'../index.html': '<h1>Bad</h1>'}, 'unsafe'),
    ({'/index.html': '<h1>Bad</h1>'}, 'unsafe'),
    ({'C:\\site\\index.html': '<h1>Bad</h1>'}, 'unsafe'),
    ({'index.html': '<h1>Site</h1>', 'submit.php': '<?php echo 1; ?>'}, 'server-side'),
    ({'site.css': 'body {}'}, 'does not contain'),
    ({'index.html': ''}, 'empty HTML'),
    ({'index.html': '<html><?php echo 1; ?></html>'}, 'template tags'),
])
def test_rejects_invalid_static_archives(tmp_path, files, message):
    path = tmp_path / 'bad.zip'
    path.write_bytes(archive_bytes(files))
    with pytest.raises(ValueError, match=message):
        inspect_static_archive(path)


def test_rejects_symbolic_links_and_expansion_limits(tmp_path, monkeypatch):
    path = tmp_path / 'bad.zip'
    with zipfile.ZipFile(path, 'w') as archive:
        info = zipfile.ZipInfo('index.html')
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        archive.writestr(info, '/etc/passwd')
    with pytest.raises(ValueError, match='symbolic'):
        inspect_static_archive(path)
    path.write_bytes(archive_bytes({'index.html': '<h1>Site</h1>'}))
    monkeypatch.setattr('src.engine.source_zip.MAX_EXPANDED_BYTES', 2)
    with pytest.raises(ValueError, match='Expanded ZIP'):
        inspect_static_archive(path)


def test_rejects_duplicate_names(tmp_path):
    path = tmp_path / 'duplicate.zip'
    with zipfile.ZipFile(path, 'w') as archive:
        archive.writestr('index.html', '<h1>One</h1>')
        archive.writestr('./index.html', '<h1>Two</h1>')
    with zipfile.ZipFile(path) as archive, pytest.raises(ValueError, match='duplicate'):
        website_members(archive)


def test_upload_is_durable_owner_scoped_and_handed_to_existing_engine(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'JOB_STORE_PATH', str(tmp_path / 'jobs.db'))
    monkeypatch.setattr(settings, 'PREVIEW_API_SECRET', 'private')
    client = TestClient(main.app)
    content = archive_bytes({'site/index.html': '<html><h1>Hello</h1></html>', 'site/app.js': 'document.title="Hello"'})
    headers = {'X-Preview-Secret': 'private', 'X-Source-Owner': 'owner'}
    assert client.post('/api/sources/zip?filename=site.zip', content=content).status_code == 403
    response = client.post('/api/sources/zip?filename=site.zip', content=content, headers=headers)
    assert response.status_code == 201, response.text
    upload = response.json()
    assert upload['pages'] == 1 and upload['assets'] == 1
    archive = tmp_path / 'source-uploads' / (upload['id'] + '.zip')
    assert archive.read_bytes() == content
    assert 'owner_id' not in upload
    captured = {}
    def create(**kwargs):
        captured.update(kwargs)
        return {'job_id': 'zip-job'}
    async def no_background(_job_id):
        pass
    monkeypatch.setattr(main.engine, 'create_job', create)
    monkeypatch.setattr(main, 'execute_real_conversion_job', no_background)
    body = {'source_upload_id': upload['id']}
    assert client.post('/api/jobs', json=body, headers={**headers, 'X-Source-Owner': 'other'}).status_code == 403
    assert client.post('/api/jobs', json={**body, 'url': 'https://example.com'}, headers=headers).status_code == 400
    assert client.post('/api/jobs', json=body, headers=headers).status_code == 200
    assert captured['input_url'] == str(archive)
    assert captured['crawl_config']['enforce_static_source'] is True
    assert client.delete('/api/sources/zip/' + upload['id'], headers={**headers, 'X-Source-Owner': 'other'}).status_code == 403
    assert client.delete('/api/sources/zip/' + upload['id'], headers=headers).status_code == 200
    assert not archive.exists()


def test_failed_upload_leaves_no_files(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, 'JOB_STORE_PATH', str(tmp_path / 'jobs.db'))
    monkeypatch.setattr(settings, 'PREVIEW_API_SECRET', 'private')
    headers = {'X-Preview-Secret': 'private', 'X-Source-Owner': 'owner'}
    response = TestClient(main.app).post('/api/sources/zip?filename=bad.zip', content=b'not a zip', headers=headers)
    assert response.status_code == 400
    assert list((tmp_path / 'source-uploads').iterdir()) == []
