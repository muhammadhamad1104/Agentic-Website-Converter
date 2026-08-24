from __future__ import annotations

import json
from pathlib import Path
import zipfile
from unittest.mock import patch
from urllib.parse import urlparse

import pytest

from src.engine.nodes import crawl_site_node


class _FakeResponse:
    def __init__(self, url: str, payload: str | bytes, content_type: str, status_code: int = 200) -> None:
        self.url = url
        self.status_code = status_code
        self.headers = {"content-type": content_type}
        if isinstance(payload, bytes):
            self.content = payload
            self.text = payload.decode("utf-8", errors="replace")
        else:
            self.text = payload
            self.content = payload.encode("utf-8")

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


def test_crawl_site_node_captures_pages_assets_and_manifest(tmp_path) -> None:
    root_html = """
    <html>
      <head>
        <link rel='stylesheet' href='/assets/site.css'>
        <script src='/assets/app.js'></script>
      </head>
      <body style="background-image: url('/images/bg.jpg')">
        <a href='/about'>About</a>
        <img src='/images/logo.png' alt='logo'>
      </body>
    </html>
    """
    about_html = "<html><body><h1>About</h1></body></html>"
    css_text = "body { background-image: url('../images/pattern.svg'); }"

    response_map: dict[str, tuple[str | bytes, str]] = {
        "/": (root_html, "text/html"),
        "/about": (about_html, "text/html"),
        "/assets/site.css": (css_text, "text/css"),
        "/assets/app.js": ("console.log('ok');", "application/javascript"),
        "/images/logo.png": (b"PNGDATA", "image/png"),
        "/images/bg.jpg": (b"JPGDATA", "image/jpeg"),
        "/images/pattern.svg": ("<svg></svg>", "image/svg+xml"),
    }

    def fake_get(url: str, timeout: int = 20):
        parsed = urlparse(url)
        lookup_path = parsed.path or "/"
        if lookup_path not in response_map:
            raise RuntimeError(f"Unexpected URL requested: {url}")
        payload, content_type = response_map[lookup_path]
        return _FakeResponse(url=url, payload=payload, content_type=content_type)

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes.requests.get", side_effect=fake_get):
            result = crawl_site_node(
                {
                    "job_id": "crawl-test-job",
                    "input_url": "https://example.com",
                    "crawl_depth_limit": 2,
                    "crawl_max_pages": 10,
                    "crawl_max_assets": 20,
                    "crawl_same_domain_only": True,
                    "crawl_follow_asset_domains": True,
                    "crawl_request_timeout_seconds": 5,
                    "crawl_request_retries": 2,
                    "crawl_include_sitemap_seeds": False,
                    "crawl_render_js": False,
                    "errors": [],
                }
            )

    assert result["status"] == "crawled"
    assert len(result["crawled_pages"]) == 2

    crawl_artifacts = result["crawl_artifacts"]
    assert crawl_artifacts["totals"]["pages_crawled"] == 2
    assert crawl_artifacts["totals"]["assets_downloaded"] >= 5

    manifest_path = Path(crawl_artifacts["manifest_path"])
    assert manifest_path.exists()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["totals"]["pages_crawled"] == 2
    assert manifest["totals"]["assets_downloaded"] >= 5

    for record in crawl_artifacts["pages"] + crawl_artifacts["assets"]:
        assert Path(record["storage_path"]).exists()


def test_crawl_site_node_skips_cross_domain_assets_when_disabled(tmp_path) -> None:
    requested_urls: list[str] = []

    def fake_get(url: str, timeout: int = 20):
        requested_urls.append(url)
        parsed = urlparse(url)
        path = parsed.path or "/"
        if parsed.netloc == "example.com" and path == "/":
            return _FakeResponse(
                url=url,
                payload="<html><body><img src='https://cdn.example/logo.png'></body></html>",
                content_type="text/html",
            )
        if parsed.netloc == "cdn.example" and path == "/logo.png":
            return _FakeResponse(url=url, payload=b"LOGO", content_type="image/png")
        raise RuntimeError(f"Unexpected URL requested: {url}")

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes.requests.get", side_effect=fake_get):
            result = crawl_site_node(
                {
                    "job_id": "crawl-cross-domain-test",
                    "input_url": "https://example.com",
                    "crawl_depth_limit": 1,
                    "crawl_max_pages": 3,
                    "crawl_max_assets": 10,
                    "crawl_same_domain_only": True,
                    "crawl_follow_asset_domains": False,
                    "crawl_request_timeout_seconds": 5,
                    "crawl_request_retries": 1,
                    "crawl_include_sitemap_seeds": False,
                    "crawl_render_js": False,
                    "errors": [],
                }
            )

    assert result["status"] == "crawled"
    crawl_artifacts = result["crawl_artifacts"]
    assert crawl_artifacts["assets"] == []
    assert any("cross-domain" in item["error"] for item in crawl_artifacts["failures"])
    assert all("cdn.example" not in url for url in requested_urls)


def test_crawl_site_node_zero_limits_enable_unbounded_crawl(tmp_path) -> None:
    response_map: dict[str, tuple[str, str]] = {
        "/": ("<html><body><a href='/a'>A</a></body></html>", "text/html"),
        "/a": ("<html><body><a href='/b'>B</a></body></html>", "text/html"),
        "/b": ("<html><body><a href='/c'>C</a></body></html>", "text/html"),
        "/c": ("<html><body><h1>Done</h1></body></html>", "text/html"),
    }

    def fake_get(url: str, timeout: int = 20):
        parsed = urlparse(url)
        lookup_path = parsed.path or "/"
        if lookup_path not in response_map:
            raise RuntimeError(f"Unexpected URL requested: {url}")
        payload, content_type = response_map[lookup_path]
        return _FakeResponse(url=url, payload=payload, content_type=content_type)

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes.requests.get", side_effect=fake_get):
            result = crawl_site_node(
                {
                    "job_id": "crawl-unbounded-test",
                    "input_url": "https://example.com",
                    "crawl_depth_limit": 5,
                    "crawl_max_pages": 0,
                    "crawl_max_assets": 0,
                    "crawl_same_domain_only": True,
                    "crawl_follow_asset_domains": True,
                    "crawl_request_timeout_seconds": 5,
                    "crawl_request_retries": 1,
                    "crawl_include_sitemap_seeds": False,
                    "crawl_render_js": False,
                    "errors": [],
                }
            )

    assert result["status"] == "crawled"
    assert result["crawl_artifacts"]["totals"]["pages_crawled"] == 4
    assert result["crawl_artifacts"]["limits"]["pages_limit_hit"] is False


def test_crawl_site_node_render_fallbacks_to_requests_when_playwright_unavailable(tmp_path) -> None:
    def fake_get(url: str, timeout: int = 20):
        parsed = urlparse(url)
        if (parsed.path or "/") != "/":
            raise RuntimeError(f"Unexpected URL requested: {url}")
        return _FakeResponse(url=url, payload="<html><body><h1>Home</h1></body></html>", content_type="text/html")

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes._PlaywrightCrawlerSession.open", side_effect=RuntimeError("playwright unavailable")):
            with patch("src.engine.nodes.requests.get", side_effect=fake_get):
                result = crawl_site_node(
                    {
                        "job_id": "crawl-render-fallback",
                        "input_url": "https://example.com",
                        "crawl_depth_limit": 1,
                        "crawl_max_pages": 2,
                        "crawl_max_assets": 0,
                        "crawl_same_domain_only": True,
                        "crawl_follow_asset_domains": True,
                        "crawl_request_timeout_seconds": 5,
                        "crawl_request_retries": 1,
                        "crawl_include_sitemap_seeds": False,
                        "crawl_render_js": True,
                        "crawl_render_wait_seconds": 1,
                        "crawl_render_headless": True,
                        "errors": [],
                    }
                )

    assert result["status"] == "crawled"
    assert result["crawl_artifacts"]["render_engine"] == "requests"
    assert result["crawl_artifacts"]["render_fallback_reason"] is not None


def test_crawl_site_node_disable_tls_passes_verify_false(tmp_path) -> None:
    observed_verify_values: list[bool] = []

    def fake_get(url: str, timeout: int = 20, verify: bool = True):
        observed_verify_values.append(bool(verify))
        return _FakeResponse(url=url, payload="<html><body>OK</body></html>", content_type="text/html")

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes.requests.get", side_effect=fake_get):
            result = crawl_site_node(
                {
                    "job_id": "crawl-verify-toggle",
                    "input_url": "https://example.com",
                    "crawl_depth_limit": 1,
                    "crawl_max_pages": 2,
                    "crawl_max_assets": 0,
                    "crawl_same_domain_only": True,
                    "crawl_follow_asset_domains": True,
                    "crawl_request_timeout_seconds": 5,
                    "crawl_request_retries": 1,
                    "crawl_verify_tls": False,
                    "crawl_include_sitemap_seeds": False,
                    "crawl_render_js": False,
                    "errors": [],
                }
            )

    assert result["status"] == "crawled"
    assert observed_verify_values
    assert all(value is False for value in observed_verify_values)


def test_crawl_site_node_resumes_from_checkpoint_after_interruption(tmp_path) -> None:
    pages = {
        "/": "<html><body><a href='/a'>A</a></body></html>",
        "/a": "<html><body><a href='/b'>B</a></body></html>",
        "/b": "<html><body>Done</body></html>",
    }

    def fake_get(url: str, timeout: int = 20, verify: bool = True):
        parsed = urlparse(url)
        lookup_path = parsed.path or "/"
        if lookup_path not in pages:
            raise RuntimeError(f"Unexpected URL requested: {url}")
        return _FakeResponse(url=url, payload=pages[lookup_path], content_type="text/html")

    from src.engine import nodes as nodes_module

    original_write_snapshot = nodes_module._write_snapshot_file
    state = {"crashed": False}

    def flaky_write_snapshot(
        directory: Path,
        kind: str,
        index: int,
        source_url: str,
        content: bytes,
        content_type: str,
    ) -> Path:
        if kind == "page" and index == 2 and not state["crashed"]:
            state["crashed"] = True
            raise RuntimeError("simulated crash during page snapshot")
        return original_write_snapshot(directory, kind, index, source_url, content, content_type)

    common_input = {
        "job_id": "crawl-resume-test",
        "input_url": "https://example.com",
        "crawl_depth_limit": 3,
        "crawl_max_pages": 0,
        "crawl_max_assets": 0,
        "crawl_same_domain_only": True,
        "crawl_follow_asset_domains": True,
        "crawl_request_timeout_seconds": 5,
        "crawl_request_retries": 1,
        "crawl_verify_tls": True,
        "crawl_resume_from_checkpoint": True,
        "crawl_include_sitemap_seeds": False,
        "crawl_render_js": False,
        "errors": [],
    }

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes.requests.get", side_effect=fake_get):
            with patch("src.engine.nodes._write_snapshot_file", side_effect=flaky_write_snapshot):
                with pytest.raises(RuntimeError, match="simulated crash"):
                    crawl_site_node(common_input)

    checkpoint_path = tmp_path / "py_agent_crawl_cache" / "crawl-resume-test" / "checkpoint.json"
    assert checkpoint_path.exists()

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes.requests.get", side_effect=fake_get):
            resumed = crawl_site_node(common_input)

    assert resumed["status"] == "crawled"
    assert resumed["crawl_artifacts"]["resumed_from_checkpoint"] is True
    assert resumed["crawl_artifacts"]["totals"]["pages_crawled"] == 3


def test_crawl_site_node_blocks_dynamic_url_sources(tmp_path) -> None:
    dynamic_html = """
    <html>
      <body>
        <form action='/submit.php' method='post'>
          <input type='text' name='name'>
        </form>
      </body>
    </html>
    """

    def fake_get(url: str, timeout: int = 20):
        return _FakeResponse(url=url, payload=dynamic_html, content_type="text/html")

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        with patch("src.engine.nodes.requests.get", side_effect=fake_get):
            result = crawl_site_node(
                {
                    "job_id": "crawl-dynamic-block",
                    "input_url": "https://example.com",
                    "crawl_depth_limit": 1,
                    "crawl_max_pages": 5,
                    "crawl_max_assets": 5,
                    "crawl_same_domain_only": True,
                    "crawl_follow_asset_domains": True,
                    "crawl_request_timeout_seconds": 5,
                    "crawl_request_retries": 1,
                    "crawl_enforce_static_source": True,
                    "crawl_include_sitemap_seeds": False,
                    "crawl_render_js": False,
                    "errors": [],
                }
            )

    assert result["status"] == "failed"
    assert any("dynamic behavior" in item.lower() for item in result["errors"])


def test_crawl_site_node_supports_static_zip_input(tmp_path) -> None:
    zip_path = tmp_path / "static_site.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("index.html", "<html><body><h1>Hello</h1></body></html>")
        archive.writestr("assets/site.css", "body { color: #111; }")
        archive.writestr("images/logo.svg", "<svg></svg>")

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        result = crawl_site_node(
            {
                "job_id": "crawl-static-zip",
                "input_url": str(zip_path),
                "crawl_max_pages": 0,
                "crawl_max_assets": 0,
                "crawl_request_timeout_seconds": 5,
                "crawl_request_retries": 1,
                "crawl_verify_tls": True,
                "crawl_enforce_static_source": True,
                "errors": [],
            }
        )

    assert result["status"] == "crawled"
    assert result["sitemap"]["source_type"] == "zip"
    assert result["crawl_artifacts"]["source_type"] == "zip"
    assert result["crawl_artifacts"]["totals"]["pages_crawled"] == 1
    assert result["crawl_artifacts"]["totals"]["assets_downloaded"] == 2


def test_crawl_site_node_blocks_dynamic_zip_input(tmp_path) -> None:
    zip_path = tmp_path / "dynamic_site.zip"
    with zipfile.ZipFile(zip_path, "w") as archive:
        archive.writestr("index.html", "<html><body>Hello</body></html>")
        archive.writestr("submit.php", "<?php echo 'x'; ?>")

    with patch("src.engine.nodes.tempfile.gettempdir", return_value=str(tmp_path)):
        result = crawl_site_node(
            {
                "job_id": "crawl-dynamic-zip",
                "input_url": str(zip_path),
                "crawl_request_timeout_seconds": 5,
                "crawl_request_retries": 1,
                "crawl_verify_tls": True,
                "crawl_enforce_static_source": True,
                "errors": [],
            }
        )

    assert result["status"] == "failed"
    assert any("server-side files" in item.lower() for item in result["errors"])
